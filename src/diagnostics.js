import { spawn } from "node:child_process";
import { isWithinAllowed } from "./config.js";

const MAX_OUTPUT_BYTES = 50_000;
const DIAGNOSTIC_TIMEOUT_MS = 10_000;
const WINDOWS_ONLY_ERROR =
	"Diagnosticos PowerShell sao suportados apenas em hosts Windows";

const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$requestJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TC_BRIDGE_DIAGNOSTIC_REQUEST))
$request = $requestJson | ConvertFrom-Json

$result = switch ($request.check) {
	'path_exists' {
		[PSCustomObject]@{
			remote_path = $request.remote_path
			exists = Test-Path -LiteralPath $request.remote_path
		}
	}
	'service_status' {
		$service = Get-Service -Name $request.service_name -ErrorAction Stop
		[PSCustomObject]@{
			name = $service.Name
			display_name = $service.DisplayName
			status = [string]$service.Status
		}
	}
	'tcp_connect' {
		$result = Test-NetConnection -ComputerName $request.host -Port $request.port -InformationLevel Detailed
		[PSCustomObject]@{
			host = $request.host
			remote_address = [string]$result.RemoteAddress
			port = [int]$request.port
			tcp_succeeded = [bool]$result.TcpTestSucceeded
		}
	}
	default { throw "Diagnostico nao permitido: $($request.check)" }
}
$result | ConvertTo-Json -Compress
`;

function assertString(value, name, pattern) {
	if (typeof value !== "string" || !pattern.test(value)) {
		throw new Error(`Parametro invalido: ${name}`);
	}
	return value;
}

export function validateDiagnosticRequest(request, cfg) {
	if (!request || typeof request !== "object") {
		throw new Error("Diagnostico invalido");
	}

	switch (request.check) {
		case "path_exists": {
			const remotePath = assertString(
				request.remote_path,
				"remote_path",
				/^[^\0]{1,4096}$/,
			);
			if (!isWithinAllowed(remotePath, cfg.readPaths)) {
				throw new Error(`Path fora da whitelist de leitura: ${remotePath}`);
			}
			return { check: request.check, remote_path: remotePath };
		}
		case "service_status":
			return {
				check: request.check,
				service_name: assertString(
					request.service_name,
					"service_name",
					/^[\w .-]{1,256}$/,
				),
			};
		case "tcp_connect": {
			const host = assertString(
				request.host,
				"host",
				/^[a-zA-Z0-9.:-]{1,253}$/,
			);
			const allowedHosts = new Set(
				cfg.diagnosticHosts.map((item) => item.toLowerCase()),
			);
			if (!allowedHosts.has(host.toLowerCase())) {
				throw new Error(`Host fora da whitelist de diagnostico: ${host}`);
			}
			if (
				!Number.isInteger(request.port) ||
				request.port < 1 ||
				request.port > 65535
			) {
				throw new Error("Parametro invalido: port");
			}
			return { check: request.check, host, port: request.port };
		}
		default:
			throw new Error(`Diagnostico nao permitido: ${request.check}`);
	}
}

function runPowerShell(request) {
	return new Promise((resolve, reject) => {
		const encodedRequest = Buffer.from(
			JSON.stringify(request),
			"utf8",
		).toString("base64");
		const child = spawn(
			"powershell.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				POWERSHELL_SCRIPT,
			],
			{
				windowsHide: true,
				env: {
					...process.env,
					TC_BRIDGE_DIAGNOSTIC_REQUEST: encodedRequest,
				},
			},
		);
		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			fn(value);
		};
		const append = (target, chunk) =>
			`${target}${chunk}`.slice(-MAX_OUTPUT_BYTES);
		const timeout = setTimeout(() => {
			child.kill();
			finish(reject, new Error("Diagnostico excedeu o limite de 10 segundos"));
		}, DIAGNOSTIC_TIMEOUT_MS);

		child.stdout.on("data", (chunk) => {
			stdout = append(stdout, String(chunk));
		});
		child.stderr.on("data", (chunk) => {
			stderr = append(stderr, String(chunk));
		});
		child.once("error", (err) => finish(reject, err));
		child.once("exit", (code) => {
			if (code !== 0) {
				finish(
					reject,
					new Error(stderr.trim() || `PowerShell encerrou com codigo ${code}`),
				);
				return;
			}
			try {
				finish(resolve, JSON.parse(stdout.trim()));
			} catch {
				finish(reject, new Error("Resposta invalida do PowerShell"));
			}
		});
	});
}

export async function runDiagnostic(request, cfg) {
	if (process.platform !== "win32") throw new Error(WINDOWS_ONLY_ERROR);
	const validated = validateDiagnosticRequest(request, cfg);
	return runPowerShell(validated);
}
