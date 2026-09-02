const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 50;

const DIAGNOSTICS = new Map([
	[
		"database_files",
		{
			description: "Tamanho e uso dos arquivos de dados e log da base atual",
			query: `
SELECT
  name,
  type_desc,
  CAST(size * 8.0 / 1024 AS decimal(18,2)) AS size_mb,
  CASE WHEN type = 0
    THEN CAST(FILEPROPERTY(name, 'SpaceUsed') * 8.0 / 1024 AS decimal(18,2))
  END AS used_mb,
  CASE WHEN is_percent_growth = 1 THEN growth ELSE growth * 8.0 / 1024 END AS growth_value,
  CASE WHEN is_percent_growth = 1 THEN 'percent' ELSE 'mb' END AS growth_unit,
  CASE WHEN max_size = -1 THEN NULL ELSE CAST(max_size * 8.0 / 1024 AS decimal(18,2)) END AS max_size_mb
FROM sys.database_files
ORDER BY type_desc, name;`,
		},
	],
	[
		"encoding_profile",
		{
			description:
				"Collation e pagina de codigo efetivas da instancia e do banco Teamcenter",
			query: `
WITH database_settings AS (
  SELECT CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS database_collation
)
SELECT
  CONVERT(nvarchar(128), SERVERPROPERTY('Collation')) AS server_collation,
  database_collation,
  COLLATIONPROPERTY(database_collation, 'CodePage') AS database_code_page
FROM database_settings;`,
		},
	],
	[
		"text_column_types",
		{
			description:
				"Quantidade de colunas de texto Teamcenter por tipo fisico no banco",
			query: `
SELECT
  ty.name AS data_type,
  COUNT(*) AS column_count
FROM sys.columns AS c
INNER JOIN sys.tables AS t ON t.object_id = c.object_id
INNER JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE t.is_ms_shipped = 0
  AND ty.name IN ('char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext')
GROUP BY ty.name
ORDER BY ty.name;`,
		},
	],
	[
		"waits",
		{
			description: "Principais esperas acumuladas da instância SQL Server",
			query: `
SELECT TOP (@limit)
  wait_type,
  waiting_tasks_count,
  wait_time_ms,
  signal_wait_time_ms,
  wait_time_ms - signal_wait_time_ms AS resource_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_type NOT LIKE 'SLEEP%'
  AND wait_type NOT IN (
    'BROKER_EVENTHANDLER', 'BROKER_RECEIVE_WAITFOR', 'BROKER_TASK_STOP',
    'BROKER_TO_FLUSH', 'BROKER_TRANSMITTER', 'CHECKPOINT_QUEUE',
    'CLR_AUTO_EVENT', 'CLR_MANUAL_EVENT', 'DIRTY_PAGE_POLL',
    'DISPATCHER_QUEUE_SEMAPHORE', 'FT_IFTS_SCHEDULER_IDLE_WAIT',
    'HADR_FILESTREAM_IOMGR_IOCOMPLETION', 'LAZYWRITER_SLEEP',
    'ONDEMAND_TASK_QUEUE', 'REQUEST_FOR_DEADLOCK_SEARCH',
    'SQLTRACE_BUFFER_FLUSH', 'SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
    'WAITFOR', 'XE_DISPATCHER_WAIT', 'XE_TIMER_EVENT')
ORDER BY wait_time_ms DESC;`,
		},
	],
	[
		"active_requests",
		{
			description: "Requisições SQL ativas mais demoradas, sem texto SQL",
			query: `
SELECT TOP (@limit)
  r.session_id,
  s.login_name,
  s.host_name,
  r.status,
  r.command,
  r.wait_type,
  r.wait_time,
  r.blocking_session_id,
  r.cpu_time,
  r.total_elapsed_time,
  r.reads,
  r.writes,
  r.logical_reads,
  CONVERT(varchar(34), r.query_hash, 1) AS query_hash
FROM sys.dm_exec_requests AS r
INNER JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
WHERE r.session_id <> @@SPID
ORDER BY r.total_elapsed_time DESC;`,
		},
	],
	[
		"expensive_queries",
		{
			description:
				"Consultas agregadas mais custosas, identificadas apenas por hash",
			query: `
SELECT TOP (@limit)
  CONVERT(varchar(34), qs.query_hash, 1) AS query_hash,
  qs.execution_count,
  CAST(qs.total_elapsed_time / NULLIF(qs.execution_count, 0) AS bigint) AS avg_elapsed_time_us,
  CAST(qs.total_worker_time / NULLIF(qs.execution_count, 0) AS bigint) AS avg_cpu_time_us,
  CAST(qs.total_logical_reads / NULLIF(qs.execution_count, 0) AS bigint) AS avg_logical_reads,
  qs.total_physical_reads,
  qs.last_execution_time
FROM sys.dm_exec_query_stats AS qs
WHERE qs.query_hash IS NOT NULL
ORDER BY qs.total_worker_time DESC;`,
		},
	],
	[
		"index_health",
		{
			description:
				"Índices grandes com maior fragmentação, usando modo LIMITED",
			query: `
SELECT TOP (@limit)
  SCHEMA_NAME(o.schema_id) AS schema_name,
  o.name AS table_name,
  i.name AS index_name,
  ips.index_type_desc,
  ips.page_count,
  CAST(ips.avg_fragmentation_in_percent AS decimal(6,2)) AS avg_fragmentation_percent
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') AS ips
INNER JOIN sys.indexes AS i
  ON i.object_id = ips.object_id AND i.index_id = ips.index_id
INNER JOIN sys.objects AS o ON o.object_id = ips.object_id
WHERE ips.index_id > 0
  AND ips.page_count >= 1000
  AND o.is_ms_shipped = 0
ORDER BY ips.avg_fragmentation_in_percent DESC, ips.page_count DESC;`,
		},
	],
]);

function assertLimit(value) {
	if (value === undefined) return DEFAULT_RESULT_LIMIT;
	if (!Number.isInteger(value) || value < 1 || value > MAX_RESULT_LIMIT) {
		throw new Error(
			`Parametro invalido: limit (use um inteiro entre 1 e ${MAX_RESULT_LIMIT})`,
		);
	}
	return value;
}

export function validateDbDiagnosticRequest(request) {
	if (!request || typeof request !== "object") {
		throw new Error("Diagnostico de banco invalido");
	}
	if (typeof request.check !== "string" || !DIAGNOSTICS.has(request.check)) {
		throw new Error(
			`Diagnostico de banco nao permitido: ${String(request.check)}`,
		);
	}
	return { check: request.check, limit: assertLimit(request.limit) };
}

export function listDbDiagnostics() {
	return [...DIAGNOSTICS.entries()].map(([check, definition]) => ({
		check,
		description: definition.description,
	}));
}

export function resolveMssqlModule(importedModule) {
	return importedModule.default ?? importedModule;
}

function sqlConfig(cfg) {
	return {
		server: cfg.dbServer,
		port: cfg.dbPort,
		database: cfg.dbName,
		user: cfg.dbUser,
		password: cfg.dbPassword,
		connectionTimeout: cfg.dbConnectTimeoutMs,
		requestTimeout: cfg.dbRequestTimeoutMs,
		pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
		options: {
			encrypt: cfg.dbEncrypt,
			trustServerCertificate: cfg.dbTrustServerCertificate,
		},
	};
}

async function loadMssql() {
	try {
		return resolveMssqlModule(await import("mssql"));
	} catch {
		throw new Error(
			"Dependencia MSSQL ausente; execute npm install antes de habilitar diagnosticos de banco",
		);
	}
}

async function withSqlPool(sql, dbConfig, work) {
	const pool = new sql.ConnectionPool(sqlConfig(dbConfig));
	try {
		await pool.connect();
		return await work(pool);
	} finally {
		await pool.close().catch(() => {});
	}
}

export async function runDbDiagnostic(request, cfg) {
	const validated = validateDbDiagnosticRequest(request);
	const definition = DIAGNOSTICS.get(validated.check);
	const sql = await loadMssql();
	return withSqlPool(sql, cfg, async (pool) => {
		const statement = pool.request().input("limit", sql.Int, validated.limit);
		const result = await statement.query(definition.query);
		return {
			check: validated.check,
			description: definition.description,
			rows: result.recordset,
			row_count: result.recordset.length,
			limit: validated.limit,
		};
	});
}

const SNAPSHOT_QUERIES = {
	server_version: `
SELECT
  CONVERT(nvarchar(128), SERVERPROPERTY('ProductLevel')) AS level,
  CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS version,
  CONVERT(nvarchar(128), SERVERPROPERTY('Edition')) AS edition`,
	collation: `
SELECT CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS collation`,
	total_size_mb: `
SELECT CAST(SUM(size * 8.0 / 1024) AS decimal(18,2)) AS total_size_mb
FROM sys.database_files`,
	index_count: `
SELECT COUNT(*) AS index_count
FROM sys.indexes AS i
INNER JOIN sys.tables AS t ON t.object_id = i.object_id
WHERE t.is_ms_shipped = 0
  AND i.index_id > 0`,
};

const COMPARE_FIELDS = [
	"server_version",
	"collation",
	"total_size_mb",
	"index_count",
];

async function snapshotEnvironment(sql, dbConfig) {
	return withSqlPool(sql, dbConfig, async (pool) => {
		const rows = {};
		for (const [field, query] of Object.entries(SNAPSHOT_QUERIES)) {
			const result = await pool.request().query(query);
			rows[field] = result.recordset[0];
		}
		return {
			server: dbConfig.dbServer,
			database: dbConfig.dbName,
			server_version: {
				version: rows.server_version?.version ?? null,
				level: rows.server_version?.level ?? null,
				edition: rows.server_version?.edition ?? null,
			},
			collation: rows.collation?.collation ?? null,
			total_size_mb: rows.total_size_mb?.total_size_mb ?? 0,
			index_count: rows.index_count?.index_count ?? 0,
		};
	});
}

// O host alvo vem da configuracao (TC_DB_TARGET_*), nunca do chamador.
export async function compareEnvironments(cfg) {
	const sql = await loadMssql();
	const targetConfig = {
		...cfg,
		dbServer: cfg.dbTargetServer,
		dbPort: cfg.dbTargetPort ?? cfg.dbPort,
		dbName: cfg.dbTargetName,
	};

	async function capture(dbConfig) {
		try {
			return await snapshotEnvironment(sql, dbConfig);
		} catch (error) {
			return {
				server: dbConfig.dbServer,
				database: dbConfig.dbName,
				connection_error: error.message,
			};
		}
	}

	const source = await capture(cfg);
	const target = await capture(targetConfig);

	const diffs = [];
	if (!source.connection_error && !target.connection_error) {
		for (const field of COMPARE_FIELDS) {
			if (JSON.stringify(source[field]) !== JSON.stringify(target[field])) {
				diffs.push({ field, source: source[field], target: target[field] });
			}
		}
	}

	return { source, target, diffs, compared_at: new Date().toISOString() };
}

const MIN_SQL_MAJOR = 13; // SQL Server 2016
const DISK_WARNING_PERCENT = 80;
const BACKUP_MAX_AGE_HOURS = 24;

function sqlVersionMajor(version) {
	const major = Number.parseInt(String(version).split(".")[0], 10);
	return Number.isNaN(major) ? null : major;
}

// Cada check tolera falha isolada (DMV ausente, msdb sem permissao).
export async function checkUpgradeReadiness(cfg) {
	const sql = await loadMssql();
	const checks = [];

	async function runCheck(name, fn) {
		try {
			await fn();
		} catch (error) {
			checks.push({
				name,
				status: "warning",
				message: `Nao foi possivel executar a verificacao: ${error.message}`,
			});
		}
	}

	await withSqlPool(sql, cfg, async (pool) => {
		await runCheck("sql_version", async () => {
			const result = await pool.request().query(`
SELECT
  CONVERT(nvarchar(128), SERVERPROPERTY('ProductLevel')) AS level,
  CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS version`);
			const row = result.recordset[0];
			const major = sqlVersionMajor(row?.version);
			checks.push({
				name: "sql_version",
				status:
					major === null
						? "warning"
						: major >= MIN_SQL_MAJOR
							? "ok"
							: "warning",
				current: row?.version ?? null,
				minimum_required: `${MIN_SQL_MAJOR}.0 (SQL Server 2016)`,
				message:
					major === null
						? "Nao foi possivel determinar a versao do SQL Server"
						: major >= MIN_SQL_MAJOR
							? "Versao do SQL Server compativel"
							: `Versao ${row.version} abaixo do minimo esperado para o TC 2606`,
			});
		});

		await runCheck("collation", async () => {
			const result = await pool.request().query(`
SELECT CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS collation`);
			const collation = result.recordset[0]?.collation ?? null;
			const binary = collation?.includes("_BIN") ?? false;
			checks.push({
				name: "collation",
				status: binary ? "ok" : "warning",
				current: collation,
				recommended: "Latin1_General_BIN",
				message: binary
					? "Collation binaria (recomendada)"
					: "Collation nao binaria pode causar inconsistencias de case no upgrade",
			});
		});

		await runCheck("disk_usage", async () => {
			const result = await pool.request().query(`
SELECT
  CAST(SUM(CASE WHEN type = 0 THEN FILEPROPERTY(name, 'SpaceUsed') * 8.0 / 1024 ELSE 0 END) AS decimal(18,2)) AS used_mb,
  CAST(SUM(CASE WHEN type = 0 THEN size * 8.0 / 1024 ELSE 0 END) AS decimal(18,2)) AS allocated_mb
FROM sys.database_files`);
			const row = result.recordset[0];
			const usedMb = row?.used_mb ?? 0;
			const allocatedMb = row?.allocated_mb ?? 0;
			const usagePercent = allocatedMb > 0 ? (usedMb / allocatedMb) * 100 : 0;
			checks.push({
				name: "disk_usage",
				status: usagePercent < DISK_WARNING_PERCENT ? "ok" : "warning",
				used_mb: usedMb,
				allocated_mb: allocatedMb,
				usage_percent: Number(usagePercent.toFixed(1)),
				message:
					usagePercent < DISK_WARNING_PERCENT
						? "Uso de espaco dentro do limite"
						: `Uso em ${usagePercent.toFixed(1)}% - avalie cleanup antes do upgrade`,
			});
		});

		await runCheck("recovery_model", async () => {
			const result = await pool.request().query(`
SELECT recovery_model_desc FROM sys.databases WHERE database_id = DB_ID()`);
			const recovery = result.recordset[0]?.recovery_model_desc ?? null;
			checks.push({
				name: "recovery_model",
				status: recovery === "FULL" ? "ok" : "warning",
				current: recovery,
				recommended: "FULL",
				message:
					recovery === "FULL"
						? "Recovery model FULL (suporta restore point-in-time)"
						: "Recovery model diferente de FULL - sem restore point-in-time",
			});
		});

		await runCheck("backup_recency", async () => {
			const result = await pool.request().query(`
SELECT TOP 1 backup_finish_date, type
FROM msdb.dbo.backupset
WHERE database_name = DB_NAME()
ORDER BY backup_finish_date DESC`);
			if (result.recordset.length === 0) {
				checks.push({
					name: "backup_recency",
					status: "critical",
					message: "Nenhum backup encontrado para a base",
				});
				return;
			}
			const lastBackup = new Date(result.recordset[0].backup_finish_date);
			const ageHours = Math.round(
				(Date.now() - lastBackup.getTime()) / 3_600_000,
			);
			checks.push({
				name: "backup_recency",
				status: ageHours < BACKUP_MAX_AGE_HOURS ? "ok" : "warning",
				last_backup: lastBackup.toISOString(),
				age_hours: ageHours,
				message:
					ageHours < BACKUP_MAX_AGE_HOURS
						? "Backup recente existe"
						: `Ultimo backup a ${ageHours}h atras`,
			});
		});

		await runCheck("query_store", async () => {
			const result = await pool.request().query(`
SELECT actual_state_desc, desired_state_desc
FROM sys.database_query_store_options`);
			if (result.recordset.length > 0) {
				const qs = result.recordset[0];
				checks.push({
					name: "query_store",
					status: qs.actual_state_desc === "READ_WRITE" ? "ok" : "info",
					current_state: qs.actual_state_desc,
					desired_state: qs.desired_state_desc,
					message:
						qs.actual_state_desc === "READ_WRITE"
							? "Query Store ativo e gravavel"
							: `Query Store em ${qs.actual_state_desc}`,
				});
			} else {
				checks.push({
					name: "query_store",
					status: "info",
					message: "Query Store sem estado reportado para a base",
				});
			}
		});
	});

	const overallStatus = checks.some((c) => c.status === "critical")
		? "not_ready"
		: checks.some((c) => c.status === "warning")
			? "ready_with_warnings"
			: "ready";

	return {
		overall_status: overallStatus,
		check_count: checks.length,
		checks,
		timestamp: new Date().toISOString(),
	};
}
