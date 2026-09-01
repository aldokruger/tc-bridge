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

export async function runDbDiagnostic(request, cfg) {
	const validated = validateDbDiagnosticRequest(request);
	const definition = DIAGNOSTICS.get(validated.check);
	let sql;
	try {
		sql = resolveMssqlModule(await import("mssql"));
	} catch {
		throw new Error(
			"Dependencia MSSQL ausente; execute npm install antes de habilitar diagnosticos de banco",
		);
	}

	const pool = new sql.ConnectionPool(sqlConfig(cfg));
	try {
		await pool.connect();
		const statement = pool.request().input("limit", sql.Int, validated.limit);
		const result = await statement.query(definition.query);
		return {
			check: validated.check,
			description: definition.description,
			rows: result.recordset,
			row_count: result.recordset.length,
			limit: validated.limit,
		};
	} finally {
		await pool.close().catch(() => {});
	}
}
