import path from "node:path";

// Classificador de arquivos BMIDE por papel no projeto.
// O analyzer não deve tratar 1.864 arquivos da mesma forma (plano §11.1).

const LOCALIZATION_PATTERN = /(?:^|[/\\])lang[/\\]/i;
const LOCALE_PATTERN =
	/_(?:en_US|fr_FR|de_DE|it_IT|ja_JP|ko_KR|pt_BR|pl_PL|es_ES|zh_CN|ru_RU)\b/i;

const CRITICAL_FILES = new Set([
	"ProjectInfo.xml",
	"master.xml",
	"dependency.xml",
	"default.xml",
	"common.xml",
]);

const GENERATED_DIR = /^(?:^|[/\\])output[/\\]/;
const INSTALL_DIR = /^(?:^|[/\\])install[/\\]/;
const ADMIN_DIR = /^(?:^|[/\\])admindata[/\\]/;

const CUSTOM_CODE_EXTS = new Set([
	".c",
	".cpp",
	".cc",
	".cxx",
	".h",
	".hpp",
	".hxx",
	".lib",
	".dll",
	".so",
	".a",
	".o",
	".obj",
]);

const CUSTOM_CODE_NAMES = new Set([
	"Makefile",
	"CMakeLists.txt",
	"makefile",
	"GNUmakefile",
]);

const IRRELEVANT_NAMES = new Set([
	".project",
	".DS_Store",
	"Thumbs.db",
	".gitignore",
]);

const IRRELEVANT_DIRS = new Set([
	".settings",
	".git",
	"node_modules",
	".claude",
]);

/**
 * Classifica um arquivo por seu papel no projeto BMIDE.
 * @param {string} relativePath - Caminho relativo ao project root
 * @returns {string} Uma das classificações: source-critical, source-model, localization, install, admin-data, generated, custom-code, irrelevant
 */
export function classifyFile(relativePath) {
	const norm = relativePath.replace(/\\/g, "/");
	const base = path.basename(norm);
	const ext = path.extname(norm).toLowerCase();

	// 1. Irrelevante: metadados IDE, temporários.
	if (IRRELEVANT_NAMES.has(base)) return "irrelevant";
	if (IRRELEVANT_DIRS.has(base)) return "irrelevant";
	if (base.startsWith(".")) return "irrelevant";

	// 2. Custom code.
	if (CUSTOM_CODE_EXTS.has(ext)) return "custom-code";
	if (CUSTOM_CODE_NAMES.has(base)) return "custom-code";

	// 3. Arquivos críticos da raiz de extensions/.
	if (CRITICAL_FILES.has(base) && norm.includes("extensions/")) {
		return "source-critical";
	}

	// 4. Generated / output.
	if (GENERATED_DIR.test(norm)) return "generated";

	// 5. Install.
	if (INSTALL_DIR.test(norm)) return "install";

	// 6. Admin data.
	if (ADMIN_DIR.test(norm)) return "admin-data";

	// 7. Localization.
	if (LOCALIZATION_PATTERN.test(norm)) return "localization";
	if (LOCALE_PATTERN.test(norm)) return "localization";

	// 8. Source model: XML em extensions/.
	if (ext === ".xml" && norm.includes("extensions/")) return "source-model";

	// 9. Default: irrelevant para arquivos não mapeados.
	return "irrelevant";
}

/**
 * Classifica uma lista de arquivos e retorna agrupamento por categoria.
 * @param {Array<{ relativePath: string }>} fileList
 * @returns {Record<string, Array<string>>}
 */
export function classifyFiles(fileList) {
	const groups = {
		"source-critical": [],
		"source-model": [],
		localization: [],
		install: [],
		"admin-data": [],
		generated: [],
		"custom-code": [],
		irrelevant: [],
	};

	for (const file of fileList) {
		const cls = classifyFile(file.relativePath);
		groups[cls].push(file.relativePath);
	}
	return groups;
}
