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
	[
		"transaction_log_health",
		{
			description:
				"Uso do log de transacoes, transacoes abertas e reutilizacao",
			query: `
SELECT
  d.name AS database_name,
  d.recovery_model_desc,
  CAST(ls.cntr_value AS bigint) AS log_size_mb,
  CAST(lu.cntr_value AS bigint) AS log_used_mb,
  CAST(CASE WHEN ls.cntr_value > 0
    THEN ROUND(lu.cntr_value * 100.0 / ls.cntr_value, 2)
    ELSE 0 END AS decimal(5,2)) AS log_used_percent,
  d.log_reuse_wait_desc,
  d.log_reuse_wait_time_ms
FROM sys.databases AS d
INNER JOIN sys.dm_os_performance_counters AS ls
  ON ls.instance_name = d.name AND ls.counter_name = 'Log File(s) Size (KB)'
INNER JOIN sys.dm_os_performance_counters AS lu
  ON lu.instance_name = d.name AND lu.counter_name = 'Log File(s) Used Size (KB)'
WHERE d.database_id = DB_ID();`,
		},
	],
	[
		"backup_history",
		{
			description: "Historico de backups full, differential e log",
			query: `
SELECT TOP (@limit)
  b.database_name,
  b.backup_start_date,
  b.backup_finish_date,
  b.type AS backup_type,
  CASE b.type WHEN 'D' THEN 'full' WHEN 'I' THEN 'differential' WHEN 'L' THEN 'log' ELSE b.type END AS backup_type_desc,
  CAST(b.backup_size / 1048576.0 AS decimal(18,2)) AS backup_size_mb,
  CAST(b.compressed_backup_size / 1048576.0 AS decimal(18,2)) AS compressed_size_mb,
  DATEDIFF(SECOND, b.backup_start_date, b.backup_finish_date) AS duration_seconds,
  b.is_damaged,
  b.has_incomplete_metadata
FROM msdb.dbo.backupset AS b
WHERE b.database_name = DB_NAME()
ORDER BY b.backup_start_date DESC;`,
		},
	],
	[
		"checkdb_history",
		{
			description: "Evidencias de execucao e resultado do ultimo DBCC CHECKDB",
			query: `
SELECT
  DB_NAME() AS database_name,
  sp.page_id,
  sp.event_type,
  sp.error_count,
  sp.last_update_date
FROM msdb.dbo.suspect_pages AS sp
WHERE sp.database_id = DB_ID()
ORDER BY sp.last_update_date DESC;`,
		},
	],
	[
		"query_store_status",
		{
			description: "Estado, tamanho, retencao e modo de captura do Query Store",
			query: `
SELECT
  actual_state_desc,
  desired_state_desc,
  current_storage_size_mb,
  max_storage_size_mb,
  capture_mode_desc,
  interval_length_minutes,
  stale_query_threshold_days,
  size_based_cleanup_mode_desc,
  max_plans_per_query,
  total_execution_count,
  total_tracked_queries,
  total_compile_count
FROM sys.database_query_store_options;`,
		},
	],
	[
		"statistics_health",
		{
			description:
				"Data da ultima atualizacao, modificacoes e amostragem das estatisticas",
			query: `
SELECT TOP (@limit)
  SCHEMA_NAME(o.schema_id) AS schema_name,
  o.name AS table_name,
  s.name AS statistic_name,
  s.auto_created,
  s.user_created,
  sp.last_updated,
  sp.rows,
  sp.rows_sampled,
  sp.modification_counter,
  CAST(CASE WHEN sp.rows > 0
    THEN ROUND(sp.rows_sampled * 100.0 / sp.rows, 2)
    ELSE 0 END AS decimal(7,2)) AS sample_percent
FROM sys.stats AS s
INNER JOIN sys.objects AS o ON o.object_id = s.object_id
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) AS sp
WHERE o.is_ms_shipped = 0
ORDER BY sp.modification_counter DESC, sp.last_updated ASC;`,
		},
	],
	[
		"index_usage",
		{
			description:
				"Seeks, scans, lookups, updates e custo de escrita dos indices",
			query: `
SELECT TOP (@limit)
  SCHEMA_NAME(o.schema_id) AS schema_name,
  o.name AS table_name,
  i.name AS index_name,
  i.type_desc,
  ius.user_seeks,
  ius.user_scans,
  ius.user_lookups,
  ius.user_updates,
  ius.last_user_seek,
  ius.last_user_scan,
  ius.last_user_lookup,
  ius.last_user_update
FROM sys.dm_db_index_usage_stats AS ius
INNER JOIN sys.indexes AS i
  ON i.object_id = ius.object_id AND i.index_id = ius.index_id
INNER JOIN sys.objects AS o ON o.object_id = ius.object_id
WHERE ius.database_id = DB_ID()
  AND i.index_id > 0
  AND o.is_ms_shipped = 0
ORDER BY ius.user_updates DESC;`,
		},
	],
	[
		"index_redundancy",
		{
			description:
				"Indices duplicados, sobrepostos e possivelmente redundantes",
			query: `
SELECT
  SCHEMA_NAME(o.schema_id) AS schema_name,
  o.name AS table_name,
  i1.name AS index_name_1,
  i2.name AS index_name_2,
  i1.type_desc AS index_type,
  (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
   FROM sys.index_columns AS ic
   INNER JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
   WHERE ic.object_id = i1.object_id AND ic.index_id = i1.index_id AND ic.is_included_column = 0
  ) AS key_columns
FROM sys.indexes AS i1
INNER JOIN sys.indexes AS i2
  ON i1.object_id = i2.object_id
  AND i1.index_id < i2.index_id
  AND i1.type_desc = i2.type_desc
INNER JOIN sys.objects AS o ON o.object_id = i1.object_id
WHERE o.is_ms_shipped = 0
  AND i1.is_primary_key = 0 AND i2.is_primary_key = 0
  AND i1.is_unique_constraint = 0 AND i2.is_unique_constraint = 0
  AND (
    EXISTS (
      SELECT 1
      FROM (
        SELECT ic.object_id, ic.index_id,
               STRING_AGG(CAST(ic.column_id AS varchar), ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS keys
        FROM sys.index_columns AS ic
        WHERE ic.is_included_column = 0
        GROUP BY ic.object_id, ic.index_id
      ) AS k1
      INNER JOIN (
        SELECT ic.object_id, ic.index_id,
               STRING_AGG(CAST(ic.column_id AS varchar), ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS keys
        FROM sys.index_columns AS ic
        WHERE ic.is_included_column = 0
        GROUP BY ic.object_id, ic.index_id
      ) AS k2
      ON k1.object_id = k2.object_id AND k1.index_id <> k2.index_id AND k1.keys = k2.keys
      WHERE k1.object_id = i1.object_id AND k1.index_id = i1.index_id AND k2.index_id = i2.index_id
    )
  )
ORDER BY schema_name, table_name, index_name_1;`,
		},
	],
	[
		"file_io_latency",
		{
			description: "Latencia, operacoes e bytes por arquivo de dados e log",
			query: `
SELECT
  DB_NAME(vfs.database_id) AS database_name,
  mf.name AS file_name,
  mf.type_desc AS file_type,
  mf.physical_name,
  vfs.num_of_reads,
  vfs.num_of_writes,
  CAST(vfs.num_of_bytes_read / 1048576.0 AS decimal(18,2)) AS read_mb,
  CAST(vfs.num_of_bytes_written / 1048576.0 AS decimal(18,2)) AS write_mb,
  CASE WHEN vfs.num_of_reads > 0
    THEN CAST(vfs.io_stall_read_ms / vfs.num_of_reads AS bigint)
    ELSE 0 END AS avg_read_latency_ms,
  CASE WHEN vfs.num_of_writes > 0
    THEN CAST(vfs.io_stall_write_ms / vfs.num_of_writes AS bigint)
    ELSE 0 END AS avg_write_latency_ms,
  vfs.io_stall AS total_io_stall_ms
FROM sys.dm_io_virtual_file_stats(DB_ID(), NULL) AS vfs
INNER JOIN sys.master_files AS mf
  ON mf.database_id = vfs.database_id AND mf.file_id = vfs.file_id
ORDER BY vfs.io_stall DESC;`,
		},
	],
	[
		"server_configuration",
		{
			description:
				"Configuracoes de memoria, CPU, MAXDOP e cost threshold da instancia",
			query: `
SELECT
  SERVERPROPERTY('ProductLevel') AS product_level,
  SERVERPROPERTY('ProductVersion') AS product_version,
  SERVERPROPERTY('Edition') AS edition,
  SERVERPROPERTY('ServerName') AS server_name,
  cpu_count,
  hyperthread_ratio,
  physical_memory_kb / 1024 AS physical_memory_mb,
  max_server_memory_kb / 1024 AS max_server_memory_mb,
  min_server_memory_kb / 1024 AS min_server_memory_mb,
  (SELECT value_in_use FROM sys.configurations WHERE name = 'max degree of parallelism') AS maxdop,
  (SELECT value_in_use FROM sys.configurations WHERE name = 'cost threshold for parallelism') AS cost_threshold_parallelism,
  (SELECT value_in_use FROM sys.configurations WHERE name = 'optimize for ad hoc workloads') AS optimize_for_ad_hoc,
  (SELECT value_in_use FROM sys.configurations WHERE name = 'max degree of parallelism for DDl') AS maxdop_ddl
FROM sys.dm_os_sys_info;`,
		},
	],
	[
		"tempdb_health",
		{
			description: "Arquivos, crescimento, capacidade e contencoes do tempdb",
			query: `
SELECT
  mf.name AS file_name,
  mf.type_desc,
  CAST(mf.size * 8.0 / 1024 AS decimal(18,2)) AS size_mb,
  CASE WHEN mf.is_percent_growth = 1
    THEN CAST(mf.growth AS varchar) + '%'
    ELSE CAST(CAST(mf.growth * 8.0 / 1024 AS decimal(18,2)) AS varchar) + ' MB'
  END AS growth,
  CAST(FILEPROPERTY(mf.name, 'SpaceUsed') * 8.0 / 1024 AS decimal(18,2)) AS used_mb,
  mf.physical_name
FROM sys.master_files AS mf
WHERE mf.database_id = DB_ID('tempdb')
ORDER BY mf.file_id;`,
		},
	],
	[
		"blocking_history",
		{
			description: "Deadlocks e bloqueios historicos do system_health",
			query: `
SELECT TOP (@limit)
  xed.value('(event/@timestamp)[1]', 'datetime2') AS event_time,
  xed.value('(event/@name)[1]', 'varchar(50)') AS event_name,
  xed.value('(event/action[@name="database_name"]/value)[1]', 'sysname') AS database_name,
  xed.value('(event/data[@name="xml_report"]/value/deadlock/process-list/process/@hostname)[1]', 'varchar(128)') AS hostname,
  xed.value('(event/data[@name="xml_report"]/value/deadlock/process-list/process/@loginname)[1]', 'varchar(128)') AS login_name,
  xed.value('(event/data[@name="xml_report"]/value/deadlock/process-list/process/@currentdb)[1]', 'int') AS current_db_id,
  xed.value('(event/data[@name="xml_report"]/value/deadlock/process-list/process/@lockMode)[1]', 'varchar(10)') AS lock_mode
FROM (
  SELECT CAST(target_data AS xml) AS target_data
  FROM sys.dm_xe_session_targets AS t
  INNER JOIN sys.dm_xe_sessions AS s ON s.address = t.event_session_address
  WHERE s.name = 'system_health' AND t.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS xed(xed)
ORDER BY xed.value('(event/@timestamp)[1]', 'datetime2') DESC;`,
		},
	],
	[
		"sql_agent_jobs",
		{
			description: "Jobs do SQL Agent, agenda, duracao, falhas e sobreposicoes",
			query: `
SELECT TOP (@limit)
  j.name AS job_name,
  j.enabled,
  j.date_created,
  j.date_modified,
  s.name AS schedule_name,
  s.freq_type,
  s.active_start_time,
  s.active_end_time,
  ja.run_requested_date AS last_run_date,
  ja.run_requested_source,
  CASE ja.run_outcome
    WHEN 0 THEN 'failed'
    WHEN 1 THEN 'succeeded'
    WHEN 2 THEN 'retry'
    WHEN 3 THEN 'canceled'
    ELSE 'unknown'
  END AS last_run_outcome,
  DATEDIFF(SECOND, ja.run_requested_date, ja.stop_execution_date) AS last_run_duration_seconds
FROM msdb.dbo.sysjobs AS j
LEFT JOIN msdb.dbo.sysjobschedules AS js ON js.job_id = j.job_id
LEFT JOIN msdb.dbo.sysschedules AS s ON s.schedule_id = js.schedule_id
LEFT JOIN (
  SELECT job_id, run_requested_date, run_requested_source, run_outcome, stop_execution_date,
         ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY run_requested_date DESC) AS rn
  FROM msdb.dbo.sysjobhistory
  WHERE step_id = 0
) AS ja ON ja.job_id = j.job_id AND ja.rn = 1
WHERE j.enabled = 1
ORDER BY j.name;`,
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
