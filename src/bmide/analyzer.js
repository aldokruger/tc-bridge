import fs from "node:fs/promises";
import path from "node:path";
import { classifyFile, classifyFiles } from "./file-classifier.js";
import { hashContent, loadIncludeGraph } from "./include-graph.js";
import { buildModel } from "./model-builder.js";
import {
	detectProjectRoot,
	listProjectFiles,
	readDependencyInfo,
	readProjectInfo,
} from "./project-locator.js";
import { resolveReferences } from "./reference-resolver.js";
import { generateId, saveFindings, saveSnapshot } from "./report-store.js";
import { checkAWCSearch } from "./rules/awc-search.js";
import { checkDeployment } from "./rules/deployment.js";
import { checkExtensions } from "./rules/extensions.js";
import { checkLocalization } from "./rules/localization.js";
import { checkLOVs } from "./rules/lovs.js";
import { checkNaming } from "./rules/naming.js";
import { checkProperties } from "./rules/properties.js";
import { checkRelations } from "./rules/relations.js";
import { checkStructure } from "./rules/structure.js";
import { checkTypes } from "./rules/types.js";
import { checkVersions } from "./rules/versions.js";
import { BMIDE_SCHEMA_VERSION } from "./schemas.js";
import {
	findElements,
	getAttributeValue,
	parseXmlDocument,
} from "./xml-parser.js";

const DEFAULT_IO = {
	readFile: (p) => fs.readFile(p, "utf-8"),
	stat: (p) => fs.stat(p),
	readdir: (p, opts) => fs.readdir(p, opts),
};

/**
 * Analisador principal de projeto BMIDE.
 * Implementa o fluxo completo: discover → classify → build → resolve → rules → report.
 */
export async function analyzeProject(request, io = DEFAULT_IO) {
	const startTime = Date.now();
	const { projectRoot, profile = "standard", environmentId } = request;

	if (!projectRoot) {
		throw new Error("projectRoot é obrigatório");
	}

	const root = path.resolve(projectRoot);

	// 1. Detectar project root.
	const detection = await detectProjectRoot(root, io);
	if (!detection) {
		throw new Error(`Projeto BMIDE não encontrado em ${root}`);
	}

	// 2. Ler metadados.
	const [projectInfo, dependencyInfo] = await Promise.all([
		readProjectInfo(detection.root, io).catch(() => ({})),
		readDependencyInfo(detection.root, io).catch(() => null),
	]);

	// 3. Listar e classificar arquivos.
	const allFiles = await listProjectFiles(detection.root, io);
	const fileGroups = classifyFiles(allFiles);

	// 4. Carregar grafo de includes.
	const extensionsDir = path.join(detection.root, "extensions");
	const includeGraph = await loadIncludeGraph(
		detection.root,
		extensionsDir,
		io,
	);

	// 5. Parse dos fragmentos fonte (profile controla profundidade).
	const sourceFiles = getSourceFiles(profile, fileGroups, includeGraph);
	const parsedFiles = await parseAllFragments(sourceFiles, detection.root, io);

	// 6. Construir modelo normalizado.
	const { entities, references, stats, wellFormednessErrors } =
		buildModel(parsedFiles);

	// 7. Resolver referências.
	const resolution = resolveReferences(entities, references, dependencyInfo);

	// 8. Executar regras.
	const allFindings = runAllRules({
		includeGraph,
		entities,
		references,
		fileGroups,
		wellFormednessErrors,
		projectInfo,
		dependencyInfo,
	});

	// 9. Gerar snapshot.
	const snapshotId = generateId("bmide-snap");
	const snapshot = {
		schemaVersion: BMIDE_SCHEMA_VERSION,
		snapshotId,
		sourceKind: "workspace",
		projectName: projectInfo?.Name || path.basename(detection.root),
		displayName: dependencyInfo?.displayName || undefined,
		guid: dependencyInfo?.guid || undefined,
		namespace: dependencyInfo?.name || undefined,
		prefixes: dependencyInfo?.prefixes || [],
		templateVersion: dependencyInfo?.templateVersion || undefined,
		mediaVersion: projectInfo?.mediaVersion || undefined,
		foundationRelease: projectInfo?.foundationRelease || undefined,
		targetEnvironmentId: environmentId || undefined,
		files: allFiles
			.filter((f) => !f.isDir)
			.map((f) => ({
				relativePath: f.relativePath,
				classification: classifyFileByPath(f.relativePath),
				size: f.size,
			})),
		includeGraph: {
			includes: includeGraph.includes,
			missing: includeGraph.missing,
			cycles: includeGraph.cycles,
			totalDepth: includeGraph.totalDepth,
			totalFiles: includeGraph.totalFiles,
		},
		dependencies: dependencyInfo?.dependencies || [],
		entities,
		references,
		packageArtifacts: [],
		sourceHash: hashContent(JSON.stringify({ entities, references })),
		createdAt: new Date().toISOString(),
	};

	saveSnapshot(snapshot);
	saveFindings(snapshotId, allFindings);

	// 10. Montar retorno compacto.
	const severitySummary = {};
	for (const f of allFindings) {
		severitySummary[f.severity] = (severitySummary[f.severity] || 0) + 1;
	}

	return {
		snapshotId,
		project: {
			name: snapshot.projectName,
			templateVersion: snapshot.templateVersion,
			mediaVersion: snapshot.mediaVersion,
		},
		summary: {
			files: allFiles.filter((f) => !f.isDir).length,
			entities: entities.length,
			references: references.length,
			resolution,
			findings: severitySummary,
			includeGraph: {
				total: includeGraph.totalFiles,
				missing: includeGraph.missing.length,
				cycles: includeGraph.cycles.length,
			},
			stats,
			elapsedMs: Date.now() - startTime,
		},
		snapshot,
	};
}

function getSourceFiles(profile, fileGroups, includeGraph) {
	const files = [];

	// Sempre incluir source-critical e source-model.
	for (const f of fileGroups["source-critical"] || []) {
		files.push(f);
	}
	for (const f of fileGroups["source-model"] || []) {
		files.push(f);
	}

	// deep: incluir localization e install.
	if (profile === "deep" || profile === "release-readiness") {
		for (const f of fileGroups["localization"] || []) {
			files.push(f);
		}
		for (const f of fileGroups["install"] || []) {
			files.push(f);
		}
	}

	return [...new Set(files)];
}

async function parseAllFragments(sourceFiles, projectRoot, io) {
	const results = [];
	for (const relPath of sourceFiles) {
		const fullPath = path.join(projectRoot, relPath);
		let xml;
		try {
			xml = await io.readFile(fullPath, "utf-8");
		} catch {
			continue;
		}
		const parseResult = parseXmlDocument(xml, { fileName: relPath });
		results.push({ fileName: relPath, parseResult, xml });
	}
	return results;
}

function runAllRules(ctx) {
	const findings = [];
	const runners = [
		checkStructure,
		checkVersions,
		checkTypes,
		checkProperties,
		checkLOVs,
		checkNaming,
		checkRelations,
		checkExtensions,
		checkAWCSearch,
		checkDeployment,
		checkLocalization,
	];
	for (const run of runners) {
		findings.push(...run(ctx));
	}
	return findings;
}

function classifyFileByPath(relativePath) {
	return classifyFile(relativePath);
}
