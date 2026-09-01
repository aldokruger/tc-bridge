package com.aldokruger.tcbridge;

import com.teamcenter.schemas.soa._2006_03.exceptions.InvalidCredentialsException;
import com.teamcenter.soa.client.Connection;
import com.teamcenter.soa.client.CredentialManager;
import com.teamcenter.soa.client.model.ModelObject;
import com.teamcenter.soa.client.model.strong.ImanQuery;
import com.teamcenter.services.strong.core.DataManagementService;
import com.teamcenter.services.strong.core.SessionService;
import com.teamcenter.services.strong.query.SavedQueryService;
import com.teamcenter.services.strong.query._2007_06.SavedQuery;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Adaptador local SOA, invocado pelo tc-bridge. Nao abre porta, nao recebe
 * credenciais por argumentos, aceita apenas as acoes declaradas e devolve um
 * envelope JSON com DTOs explicitos (sem serializador reflexivo).
 *
 * Protocolo: a requisicao chega inteira em UTF-8 via stdin como um documento
 * JSON { action, correlationId, profile, params }. A resposta e um unico
 * documento JSON em stdout: { schemaVersion, operation, status, correlationId,
 * durationMs, result?, error?, warnings?, partialErrors?, truncated? }.
 *
 * Erros de aplicacao sao carregados no envelope (status "error", codigo e
 * mensagem sanitizada) e o processo sai com codigo 0; falhas do proprio JVM
 * (linkage, OOM antes do envelope) saem com codigo != 0 e mensagem em stderr.
 */
public final class TeamcenterSoaAdapter {
    private static final String ADAPTER_VERSION = "0.3.0";
    private static final int SCHEMA_VERSION = 1;

    private TeamcenterSoaAdapter() {}

    public static void main(String[] args) {
        long startedNanos = System.nanoTime();
        String action = "";
        String correlationId = "";
        List<Map<String, String>> partialErrors = new ArrayList<>();
        try {
            SoaJson.Request request = SoaJson.parseRequest(readStdinUtf8());
            action = request.action;
            correlationId = request.correlationId;
            List<String> warnings = new ArrayList<>();
            Object result;
            switch (action) {
                case "teamcenter.soa.preflight" -> result = preflight();
                case "teamcenter.soa.connection_health" -> result = connectionHealth();
                case "teamcenter.soa.session_context" -> result = sessionContext();
                case "teamcenter.soa.health_bundle" -> result = healthBundle();
                case "teamcenter.soa.preferences.read" ->
                        result = preferencesRead(request, warnings, partialErrors);
                case "teamcenter.soa.encoding_probe" -> result = encodingProbe(request, partialErrors);
                case "teamcenter.soa.object.inspect" -> result = objectInspect(request, partialErrors);
                case "teamcenter.soa.saved_query.execute" ->
                        result = savedQueryExecute(request, partialErrors);
                case "teamcenter.soa.dataset.inspect" -> result = datasetInspect(request);
                case "teamcenter.soa.fms.probe" -> result = fmsProbe(request);
                default -> throw new SoaError("unknown_action",
                        "Acao SOA nao permitida: " + action);
            }
            String envelope = SoaJson.buildEnvelope(action, correlationId, startedNanos,
                    "completed", result, null, null, null, warnings, partialErrors);
            writeStdoutUtf8(envelope);
        } catch (SoaError error) {
            String envelope = SoaJson.buildEnvelope(action, correlationId, startedNanos,
                    "error", null, error.code, sanitize(error.getMessage()), null, null, partialErrors);
            writeStdoutUtf8(envelope);
            System.exit(0);
        } catch (Throwable error) {
            String envelope = SoaJson.buildEnvelope(action, correlationId, startedNanos,
                    "error", null, "internal", sanitize(String.valueOf(error.getMessage())),
                    null, null, partialErrors);
            writeStdoutUtf8(envelope);
            System.exit(0);
        }
    }

    // ------------------------------------------------------------------ acoes

    /** Preflight sem login: versoes, charset e classes obrigatorias. */
    private static Map<String, Object> preflight() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("adapterVersion", ADAPTER_VERSION);
        result.put("schemaVersion", SCHEMA_VERSION);
        result.put("javaVersion", System.getProperty("java.version", "unknown"));
        result.put("javaVendor", System.getProperty("java.vendor", "unknown"));
        result.put("defaultCharset", java.nio.charset.Charset.defaultCharset().name());
        result.put("fileEncoding", System.getProperty("file.encoding", "unknown"));
        result.put("clientEncodingConfigured", envOr("TC_TEAMCENTER_SOA_CLIENT_ENCODING", ""));
        result.put("soaClientPackageVersion", packageVersion("com.teamcenter.soa.client.Connection"));
        result.put("requiredClasses", requiredClasses());
        String url = envOr("TC_TEAMCENTER_URL", "");
        result.put("endpointConfigured", !url.isBlank());
        result.put("endpointScheme", schemeOf(url));
        result.put("endpointHost", hostOf(url));
        return result;
    }

    private static String packageVersion(String className) {
        try {
            Package pkg = Class.forName(className).getPackage();
            if (pkg == null) return "unknown";
            String version = pkg.getImplementationVersion();
            return version == null ? "unknown" : version;
        } catch (Throwable error) {
            return "unavailable";
        }
    }

    private static List<Map<String, Object>> requiredClasses() {
        String[] classes = {
            "com.teamcenter.soa.client.Connection",
            "com.teamcenter.services.strong.core.SessionService",
            "com.teamcenter.services.strong.core.DataManagementService",
            "com.teamcenter.services.strong.query.SavedQueryService",
        };
        List<Map<String, Object>> out = new ArrayList<>();
        for (String className : classes) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", className);
            try {
                Class.forName(className);
                item.put("loadable", true);
            } catch (Throwable error) {
                item.put("loadable", false);
                item.put("error", sanitize(String.valueOf(error.getMessage())));
            }
            out.add(item);
        }
        return out;
    }

    private static String schemeOf(String url) {
        try {
            java.net.URI uri = new java.net.URI(url);
            return uri.getScheme() == null ? "missing" : uri.getScheme();
        } catch (Exception error) {
            return "invalid";
        }
    }

    private static String hostOf(String url) {
        try {
            java.net.URI uri = new java.net.URI(url);
            return uri.getHost() == null ? "" : uri.getHost();
        } catch (Exception error) {
            return "";
        }
    }

    private static Map<String, Object> connectionHealth() throws SoaError {
        Map<String, Object> result = new LinkedHashMap<>();
        long start = System.nanoTime();
        Session session = null;
        try {
            session = openSession();
            long loginMs = (System.nanoTime() - start) / 1_000_000L;
            result.put("loginMs", loginMs);
            String probeError = null;
            String probeValue = null;
            long probeMs = 0L;
            try {
                long probeStart = System.nanoTime();
                Object user = session.loggedIn.getUser();
                if (user instanceof ModelObject userObject) {
                    Object property = invoke(userObject, "getPropertyObject", new Class<?>[] { String.class }, "object_name");
                    probeValue = propertyText(property);
                }
                probeMs = (System.nanoTime() - probeStart) / 1_000_000L;
            } catch (Throwable error) {
                probeError = sanitize(safeMessage(error));
            }
            result.put("probeMs", probeMs);
            result.put("probeProperty", "object_name");
            result.put("probeValue", probeValue);
            if (probeError != null) result.put("probeError", probeError);
            result.put("ok", probeError == null);
        } catch (SoaError error) {
            throw error;
        } catch (Throwable error) {
            throw new SoaError("connection_failed", sanitize(safeMessage(error)));
        } finally {
            if (session != null) session.close();
        }
        return result;
    }

    private static Map<String, Object> sessionContext() throws SoaError {
        Map<String, Object> result = new LinkedHashMap<>();
        Session session = openSession();
        try {
            result.put("userId", envOr("TC_TEAMCENTER_USER", ""));
            result.put("group", envOr("TC_TEAMCENTER_GROUP", ""));
            result.put("role", envOr("TC_TEAMCENTER_ROLE", ""));
            result.put("locale", envOr("TC_TEAMCENTER_LOCALE", "en_US"));
            result.put("clientEncoding", envOr("TC_TEAMCENTER_SOA_CLIENT_ENCODING", ""));
            Object user = session.loggedIn.getUser();
            if (user instanceof ModelObject userObject) {
                result.put("userUid", userObject.getUid());
                result.put("userType", typeName(userObject));
            }
            Map<String, Object> site = reflectSiteInformation(session);
            if (site != null) result.put("site", site);
        } finally {
            session.close();
        }
        return result;
    }

    private static Map<String, Object> healthBundle() throws SoaError {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("preflight", preflight());
        result.put("connection", connectionHealth());
        return result;
    }

    private static Map<String, Object> preferencesRead(SoaJson.Request request,
            List<String> warnings, List<Map<String, String>> partialErrors) throws SoaError {
        String scope = stringParam(request, "scope", "");
        List<String> names = stringListParam(request, "preferenceNames", 100);
        Session session = openSession();
        try {
            Object response = invoke(session.sessionService, "getPreferences",
                    new Class<?>[] { String.class, String[].class }, scope,
                    (Object) names.toArray(String[]::new));
            collectPartialErrors(response, partialErrors);
            String[] returnedNames = asStringArray(readField(response, "names"));
            String[] values = asStringArray(readField(response, "values"));
            List<Map<String, Object>> preferences = new ArrayList<>();
            for (int i = 0; i < (returnedNames == null ? 0 : returnedNames.length); i++) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("name", returnedNames[i]);
                String value = values != null && i < values.length ? values[i] : "";
                item.put("value", isSensitivePreference(returnedNames[i]) ? "[REDACTED]" : value);
                item.put("state", value.isEmpty() ? "empty" : "found");
                preferences.add(item);
            }
            if (preferences.isEmpty() && names.isEmpty()) {
                warnings.add("nenhuma preferencia solicitada");
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("scope", scope);
            result.put("preferences", preferences);
            return result;
        } catch (SoaError error) {
            throw error;
        } catch (Throwable error) {
            throw new SoaError("preferences_failed", sanitize(safeMessage(error)));
        } finally {
            session.close();
        }
    }

    private static boolean isSensitivePreference(String name) {
        String lower = name.toLowerCase();
        return lower.contains("password") || lower.contains("token")
                || lower.contains("secret") || lower.contains("passwd");
    }

    private static Map<String, Object> objectInspect(SoaJson.Request request,
            List<Map<String, String>> partialErrors) throws SoaError {
        Map<String, Object> result = loadObjectAndProperties(request, partialErrors);
        return result;
    }

    private static Map<String, Object> encodingProbe(SoaJson.Request request,
            List<Map<String, String>> partialErrors) throws SoaError {
        Map<String, Object> inspected = loadObjectAndProperties(request, partialErrors);
        String propertyName = stringParam(request, "propertyName", null);
        int maxTextLength = intParam(request, "maxTextLength", 1000, 10_000);

        // loadObjectAndProperties devolve "properties" como List<Map> com chaves
        // name/value/state; o probe itera a lista em vez de tratar como mapa.
        String value = findPropertyValue(propertiesList(inspected), propertyName);
        boolean truncatedByLength = value.length() > maxTextLength;
        String limited = truncatedByLength ? value.substring(0, maxTextLength) : value;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("uid", inspected.get("uid"));
        result.put("type", inspected.get("type"));
        result.put("propertyName", propertyName);
        result.put("value", limited);
        result.put("characters", limited.length());
        result.put("codePoints", limited.codePointCount(0, limited.length()));
        byte[] utf8 = limited.getBytes(StandardCharsets.UTF_8);
        result.put("utf8Bytes", utf8.length);
        result.put("sha256", sha256Hex(utf8));
        result.put("suspicious", hasSuspiciousText(limited));
        result.put("truncated", truncatedByLength);
        return result;
    }

    private static Map<String, Object> loadObjectAndProperties(SoaJson.Request request,
            List<Map<String, String>> partialErrors) throws SoaError {
        String uid = stringParam(request, "objectUid", null);
        List<String> propertyNames = stringListParam(request, "propertyNames", 50);
        List<String> allowedTypes = stringListParam(request, "allowedTypes", 20);

        Session session = openSession();
        try {
            Object loadResponse = invoke(session.dataManagement, "loadObjects",
                    new Class<?>[] { String[].class }, (Object) new String[] { uid });
            collectPartialErrors(loadResponse, partialErrors);
            Object modelObject = plainObject(loadResponse);
            if (!(modelObject instanceof ModelObject object)) {
                throw new SoaError("object_not_found",
                        "object_uid nao referencia um objeto acessivel: " + uid);
            }
            String type = typeName(object);
            if (!allowedTypes.isEmpty() && !allowedTypes.contains(type)) {
                throw new SoaError("type_not_allowed",
                        "Tipo fora da policy local: " + type + " (uid " + uid + ")");
            }

            invoke(session.dataManagement, "getProperties",
                    new Class<?>[] { ModelObject[].class, String[].class },
                    (Object) new ModelObject[] { object },
                    (Object) propertyNames.toArray(String[]::new));

            List<Map<String, Object>> properties = new ArrayList<>();
            for (String name : propertyNames) {
                Map<String, Object> property = new LinkedHashMap<>();
                property.put("name", name);
                try {
                    Object prop = invoke(object, "getPropertyObject",
                            new Class<?>[] { String.class }, name);
                    property.put("value", propertyValue(prop));
                    property.put("state", "found");
                } catch (Throwable error) {
                    property.put("state", "error");
                    property.put("error", sanitize(safeMessage(error)));
                }
                properties.add(property);
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("uid", object.getUid());
            result.put("type", type);
            result.put("properties", properties);
            return result;
        } catch (SoaError error) {
            throw error;
        } catch (Throwable error) {
            throw new SoaError("object_inspect_failed", sanitize(safeMessage(error)));
        } finally {
            session.close();
        }
    }

    private static Map<String, Object> savedQueryExecute(SoaJson.Request request,
            List<Map<String, String>> partialErrors) throws SoaError {
        String queryUid = stringParam(request, "queryUid", null);
        List<String> entries = stringListParam(request, "entries", 50);
        List<String> values = stringListParam(request, "values", 50);
        int limit = intParam(request, "limit", 20, 200);
        if (entries.size() != values.size()) {
            throw new SoaError("invalid_request", "entries e values devem ter o mesmo tamanho");
        }

        Session session = openSession();
        try {
            Object loadResponse = invoke(session.dataManagement, "loadObjects",
                    new Class<?>[] { String[].class }, (Object) new String[] { queryUid });
            collectPartialErrors(loadResponse, partialErrors);
            Object modelObject = plainObject(loadResponse);
            if (!(modelObject instanceof ImanQuery query)) {
                throw new SoaError("query_not_found",
                        "query_uid nao referencia um ImanQuery acessivel: " + queryUid);
            }

            SavedQuery.SavedQueryInput input = new SavedQuery.SavedQueryInput();
            input.query = query;
            input.entries = entries.toArray(String[]::new);
            input.values = values.toArray(String[]::new);
            input.maxNumToReturn = limit;
            input.maxNumToInflate = limit;
            Object response = SavedQueryService.getService(session.connection)
                    .executeSavedQueries(new SavedQuery.SavedQueryInput[] { input });
            collectPartialErrors(response, partialErrors);

            List<String> collected = new ArrayList<>();
            collectUids(response, collected, limit + 1, 0);
            boolean truncated = collected.size() > limit;
            List<String> uids = truncated ? collected.subList(0, limit) : collected;

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("queryUid", queryUid);
            result.put("limit", limit);
            result.put("rowCount", uids.size());
            result.put("truncated", truncated);
            List<Map<String, Object>> rows = new ArrayList<>();
            for (String rowUid : uids) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("uid", rowUid);
                rows.add(row);
            }
            result.put("rows", rows);
            return result;
        } catch (SoaError error) {
            throw error;
        } catch (Throwable error) {
            throw new SoaError("saved_query_failed", sanitize(safeMessage(error)));
        } finally {
            session.close();
        }
    }

    // ------------------------------------------------------------------ sesiao

    private static Session openSession() throws SoaError {
        String url = requiredEnv("TC_TEAMCENTER_URL");
        String user = requiredEnv("TC_TEAMCENTER_USER");
        String password = requiredEnv("TC_TEAMCENTER_PASSWORD");
        String group = envOr("TC_TEAMCENTER_GROUP", "");
        String role = envOr("TC_TEAMCENTER_ROLE", "");
        String locale = envOr("TC_TEAMCENTER_LOCALE", "en_US");
        String clientEncoding = envOr("TC_TEAMCENTER_SOA_CLIENT_ENCODING", "");
        try {
            Connection connection = new Connection(url,
                    new StandardCredentialManager(user, password, group, role));
            setClientEncoding(connection, clientEncoding);
            connection.setApplicationName("tc-bridge");
            SessionService sessionService = SessionService.getService(connection);
            sessionService.login(user, password, group, role, locale);
            DataManagementService dataManagement = DataManagementService.getService(connection);
            return new Session(connection, sessionService, dataManagement);
        } catch (InvalidCredentialsException error) {
            throw new SoaError("invalid_credentials", "Credenciais SOA invalidas");
        } catch (SoaError error) {
            throw error;
        } catch (Throwable error) {
            throw new SoaError("connection_failed", sanitize(safeMessage(error)));
        }
    }

    private static void setClientEncoding(Connection connection, String clientEncoding) throws Exception {
        if (clientEncoding == null || clientEncoding.isBlank()) return;
        Method setOption = Connection.class.getMethod("setOption", String.class, String.class);
        setOption.invoke(connection, "OPT_CLIENT_ENCODING", clientEncoding);
    }

    // ------------------------------------------------------------------ FMS/dataset (defensivo)

    /**
     * Dataset/FMS dependem de APIs e JARs da distribuicao Teamcenter 2606 e
     * so podem ser confirmados em homologacao. Aqui degradam com erro estavel:
     * se a classe nao existir, "not_available"; se existir mas a chamada nao
     * confirmar, "homologation_required". Nunca retornam tickets.
     */
    private static Map<String, Object> datasetInspect(SoaJson.Request request) throws SoaError {
        String datasetUid = stringParam(request, "datasetUid", null);
        List<String> allowedNamedReferences = stringListParam(request, "allowedNamedReferences", 50);
        Session session = openSession();
        try {
            Object service = getServiceByClass(
                    "com.teamcenter.services.strong.datamanagement.DatasetService",
                    "DatasetService indisponivel nesta distribuicao SOA; dataset.inspect requer homologacao com os jars Teamcenter 2606",
                    session.connection);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("datasetUid", datasetUid);
            result.put("namedReferences", new ArrayList<>(allowedNamedReferences));
            try {
                // Chamada best-effort; qualquer desvio de API e sinal para homologacao.
                Object loaded = invoke(service, "getDataset", new Class<?>[] { String.class }, datasetUid);
                if (loaded == null) {
                    throw new SoaError("dataset_not_found", "dataset_uid nao retornou dataset: " + datasetUid);
                }
                result.put("status", "ok");
                result.put("datasetType", typeNameOf(loaded));
            } catch (SoaError error) {
                throw error;
            } catch (Throwable error) {
                throw new SoaError("homologation_required",
                        "API DatasetService nao confirmada nesta distribuicao; revisar em homologacao: "
                                + sanitize(safeMessage(error)));
            }
            return result;
        } finally {
            session.close();
        }
    }

    private static Map<String, Object> fmsProbe(SoaJson.Request request) throws SoaError {
        String datasetUid = stringParam(request, "datasetUid", null);
        int maxBytes = intParam(request, "maxBytes", 1_048_576, 100_000_000);
        Session session = openSession();
        try {
            Object service = getServiceByClass(
                    "com.teamcenter.services.strong.fms.FileManagementService",
                    "FileManagementService indisponivel nesta distribuicao SOA; fms.probe requer homologacao com os jars Teamcenter 2606",
                    session.connection);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("datasetUid", datasetUid);
            result.put("maxBytes", maxBytes);
            try {
                Object ticket = invoke(service, "getFileTicket",
                        new Class<?>[] { String.class, String.class }, datasetUid, "content");
                if (ticket == null) {
                    throw new SoaError("fms_ticket_failed", "getFileTicket nao retornou ticket para: " + datasetUid);
                }
                // Nunca expor o ticket; somente uma sonda de tamanho se disponivel.
                result.put("status", "ok");
                result.put("ticketIssued", true);
                result.put("sizeHint", "verificar em homologacao");
            } catch (SoaError error) {
                throw error;
            } catch (Throwable error) {
                throw new SoaError("homologation_required",
                        "API FileManagementService nao confirmada nesta distribuicao; revisar em homologacao: "
                                + sanitize(safeMessage(error)));
            }
            return result;
        } finally {
            session.close();
        }
    }

    private static Object getServiceByClass(String className, String notAvailableMessage,
            Connection connection) throws SoaError {
        Class<?> serviceClass;
        try {
            serviceClass = Class.forName(className);
        } catch (Throwable error) {
            throw new SoaError("not_available", notAvailableMessage);
        }
        try {
            Method getService = serviceClass.getMethod("getService", Connection.class);
            return getService.invoke(null, connection);
        } catch (Throwable error) {
            throw new SoaError("not_available", notAvailableMessage);
        }
    }

    // ------------------------------------------------------------------ reflexao defensiva

    private static Object invoke(Object target, String methodName, Class<?>[] types, Object... args) throws Exception {
        return target.getClass().getMethod(methodName, types).invoke(target, args);
    }

    private static Object readField(Object target, String name) {
        if (target == null) return null;
        try {
            Field field = target.getClass().getField(name);
            return field.get(target);
        } catch (Throwable error) {
            return null;
        }
    }

    private static String[] asStringArray(Object value) {
        if (value == null) return null;
        if (value instanceof String[] strings) return strings;
        if (value.getClass().isArray()) {
            int length = Array.getLength(value);
            String[] out = new String[length];
            for (int i = 0; i < length; i++) out[i] = String.valueOf(Array.get(value, i));
            return out;
        }
        return null;
    }

    private static Object plainObject(Object serviceData) throws Exception {
        for (String methodName : new String[] { "getPlainObject", "getModelObject" }) {
            try {
                Method method = serviceData.getClass().getMethod(methodName, int.class);
                for (int i = 0; i < 50; i++) {
                    Object object = method.invoke(serviceData, i);
                    if (object == null) break;
                    return object;
                }
            } catch (NoSuchMethodException ignored) {
                // tenta o proximo nome
            }
        }
        return null;
    }

    private static String typeName(ModelObject object) {
        try {
            Object type = object.getType();
            if (type == null) return "unknown";
            for (String methodName : new String[] { "getTypeName", "getName" }) {
                try {
                    Object value = type.getClass().getMethod(methodName).invoke(type);
                    if (value != null) return String.valueOf(value);
                } catch (NoSuchMethodException ignored) {
                    // tenta o proximo nome
                }
            }
        } catch (Throwable ignored) {
            // cai para "unknown"
        }
        return "unknown";
    }

    private static String typeNameOf(Object target) {
        if (target instanceof ModelObject object) return typeName(object);
        return target == null ? "unknown" : target.getClass().getSimpleName();
    }

    private static Object propertyValue(Object property) throws Exception {
        if (property == null) return null;
        try {
            return property.getClass().getMethod("getStringArrayValue").invoke(property);
        } catch (NoSuchMethodException ignored) {
            return property.getClass().getMethod("getStringValue").invoke(property);
        }
    }

    private static String propertyText(Object property) {
        try {
            Object value = propertyValue(property);
            if (value == null) return null;
            if (value instanceof String[] strings && strings.length > 0) return strings[0];
            return String.valueOf(value);
        } catch (Throwable error) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> propertiesList(Map<String, Object> inspected) {
        Object raw = inspected.get("properties");
        if (raw instanceof List<?> list) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) out.add((Map<String, Object>) map);
            }
            return out;
        }
        return List.of();
    }

    private static String findPropertyValue(List<Map<String, Object>> properties, String propertyName) {
        if (propertyName == null || propertyName.isBlank()) return "";
        for (Map<String, Object> property : properties) {
            if (!propertyName.equals(property.get("name"))) continue;
            Object value = property.get("value");
            if (value == null) return "";
            if (value instanceof String[] strings && strings.length > 0) return strings[0];
            if (value instanceof List<?> list && !list.isEmpty()) return String.valueOf(list.get(0));
            return String.valueOf(value);
        }
        return "";
    }

    private static void collectPartialErrors(Object node, List<Map<String, String>> partialErrors) {
        if (node == null) return;
        Object serviceData = readField(node, "serviceData");
        if (serviceData == null) return;
        try {
            Object[] errors = (Object[]) serviceData.getClass()
                    .getMethod("getPartialErrors").invoke(serviceData);
            for (Object error : errors) {
                Map<String, String> item = new LinkedHashMap<>();
                putIfNonNull(item, "code", callText(error, "getCode"));
                putIfNonNull(item, "message", sanitize(callText(error, "getMessage")));
                putIfNonNull(item, "exceptionType", callText(error, "getExceptionType"));
                partialErrors.add(item);
            }
        } catch (Throwable ignored) {
            // shape inesperado de ServiceData; segue sem partialErrors
        }
    }

    private static String callText(Object target, String methodName) {
        try {
            Object value = target.getClass().getMethod(methodName).invoke(target);
            return value == null ? null : String.valueOf(value);
        } catch (Throwable error) {
            return null;
        }
    }

    private static void putIfNonNull(Map<String, String> map, String key, String value) {
        if (value != null && !value.isBlank()) map.put(key, value);
    }

    /** Percorre a arvore de resposta coletando UIDs de objetos (limitado). */
    private static void collectUids(Object node, List<String> uids, int max, int depth) {
        if (node == null || depth > 3 || uids.size() >= max) return;
        if (node instanceof ModelObject object) {
            uids.add(object.getUid());
            return;
        }
        try {
            Method getUid = node.getClass().getMethod("getUid");
            if (getUid.getDeclaringClass() != Object.class) {
                Object value = getUid.invoke(node);
                if (value != null) {
                    uids.add(String.valueOf(value));
                    return;
                }
            }
        } catch (Throwable ignored) {
            // nao tem getUid; continua a busca estrutural
        }
        if (node instanceof Iterable<?> iterable) {
            for (Object child : iterable) {
                collectUids(child, uids, max, depth + 1);
                if (uids.size() >= max) return;
            }
            return;
        }
        if (node.getClass().isArray()) {
            int length = Math.min(Array.getLength(node), 200);
            for (int i = 0; i < length; i++) {
                collectUids(Array.get(node, i), uids, max, depth + 1);
                if (uids.size() >= max) return;
            }
            return;
        }
        if (node instanceof Map<?, ?> map) {
            for (Object child : map.values()) {
                collectUids(child, uids, max, depth + 1);
                if (uids.size() >= max) return;
            }
            return;
        }
        try {
            for (String methodName : new String[] { "getModelObject", "getPlainObject" }) {
                try {
                    Method method = node.getClass().getMethod(methodName, int.class);
                    for (int i = 0; i < 50; i++) {
                        try {
                            Object child = method.invoke(node, i);
                            if (child == null) break;
                            collectUids(child, uids, max, depth + 1);
                            if (uids.size() >= max) return;
                        } catch (Throwable end) {
                            break;
                        }
                    }
                } catch (NoSuchMethodException ignored) {
                    // tenta o proximo nome
                }
            }
        } catch (Throwable ignored) {
            // nada a extrair
        }
    }

    private static Map<String, Object> reflectSiteInformation(Session session) {
        for (Object target : new Object[] { session.sessionService, session.loggedIn }) {
            if (target == null) continue;
            try {
                Method method = target.getClass().getMethod("getSiteInformation");
                Object info = method.invoke(target);
                if (info == null) continue;
                Map<String, Object> site = new LinkedHashMap<>();
                putIfReadable(site, "siteId", info, "getSiteId");
                putIfReadable(site, "siteName", info, "getSiteName");
                putIfReadable(site, "buildVersion", info, "getBuildVersion");
                putIfReadable(site, "buildDate", info, "getBuildDate");
                if (!site.isEmpty()) return site;
            } catch (Throwable ignored) {
                // tenta o proximo alvo
            }
        }
        return null;
    }

    private static void putIfReadable(Map<String, Object> map, String key, Object target, String methodName) {
        try {
            Object value = target.getClass().getMethod(methodName).invoke(target);
            if (value != null) map.put(key, String.valueOf(value));
        } catch (Throwable ignored) {
            // campo indisponivel nesta versao
        }
    }

    // ------------------------------------------------------------------ util

    private static String requiredEnv(String name) throws SoaError {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new SoaError("configuration", name + " nao configurado");
        }
        return value;
    }

    private static String envOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null ? fallback : value;
    }

    private static String stringParam(SoaJson.Request request, String name, String fallback) throws SoaError {
        Object value = request.params.get(name);
        if (value == null) return fallback;
        if (!(value instanceof String text)) {
            throw new SoaError("invalid_request", "parametro " + name + " deve ser string");
        }
        if (text.length() > 4096) {
            throw new SoaError("invalid_request", "parametro " + name + " excede o tamanho maximo");
        }
        return text;
    }

    private static List<String> stringListParam(SoaJson.Request request, String name, int maxItems) throws SoaError {
        Object value = request.params.get(name);
        if (value == null) return List.of();
        if (!(value instanceof List<?> list)) {
            throw new SoaError("invalid_request", "parametro " + name + " deve ser array de strings");
        }
        if (list.size() > maxItems) {
            throw new SoaError("invalid_request", "parametro " + name + " excede o maximo de " + maxItems + " itens");
        }
        List<String> out = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof String text) || text.isEmpty() || text.length() > 2048) {
                throw new SoaError("invalid_request", "parametro " + name + " contem valor invalido");
            }
            out.add(text);
        }
        return out;
    }

    private static int intParam(SoaJson.Request request, String name, int fallback, int max) throws SoaError {
        Object value = request.params.get(name);
        if (value == null) return fallback;
        if (!(value instanceof Number number)) {
            throw new SoaError("invalid_request", "parametro " + name + " deve ser numero");
        }
        int parsed = number.intValue();
        if (parsed < 1 || parsed > max) {
            throw new SoaError("invalid_request", "parametro " + name + " fora do intervalo permitido");
        }
        return parsed;
    }

    private static boolean hasSuspiciousText(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\uFFFD' || c == '\u0000') return true;
            if (Character.isSurrogate(c)) {
                if (Character.isHighSurrogate(c)) {
                    if (i + 1 >= text.length() || !Character.isLowSurrogate(text.charAt(i + 1))) return true;
                    i++;
                } else {
                    return true;
                }
            }
        }
        return false;
    }

    private static String sha256Hex(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(bytes);
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) hex.append(String.format("%02x", b & 0xff));
            return hex.toString();
        } catch (Exception error) {
            return "";
        }
    }

    private static String readStdinUtf8() throws IOException {
        byte[] bytes = System.in.readAllBytes();
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static void writeStdoutUtf8(String json) throws IOException {
        OutputStream out = new BufferedOutputStream(System.out);
        out.write(json.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    static String sanitize(String text) {
        if (text == null) return "";
        String out = text;
        out = out.replaceAll("(?i)(password|passwd|pwd|token|bearer|authorization|cookie)\\s*[=:]\\s*[^\\s,;]+", "$1=[REDACTED]");
        out = out.replaceAll("(?i)\\bOBF:[A-Za-z0-9+/=:_-]+", "[REDACTED]");
        out = out.replaceAll("(?i)\\b(grip|ticket|sig|signature)\\s*=\\s*[A-Za-z0-9+/=_-]{16,}", "$1=[REDACTED]");
        out = out.replaceAll("(?i)(jdbc|http|https)://([^\\s:@/]+):([^\\s@/]+)@", "$1://$2:[REDACTED]@");
        return out;
    }

    private static String safeMessage(Throwable error) {
        String message = error.getMessage();
        return message == null ? error.getClass().getSimpleName() : message;
    }

    // ------------------------------------------------------------------ sesiao (estado)

    private static final class Session {
        final Connection connection;
        final SessionService sessionService;
        final SessionService.Session loggedIn;
        final DataManagementService dataManagement;

        Session(Connection connection, SessionService sessionService,
                DataManagementService dataManagement) {
            this.connection = connection;
            this.sessionService = sessionService;
            this.loggedIn = sessionService.getSession();
            this.dataManagement = dataManagement;
        }

        void close() {
            try {
                sessionService.logout();
            } catch (Throwable ignored) {
                // melhor esforco; a conexao expira sozinha no servidor
            }
        }
    }

    private static final class StandardCredentialManager implements CredentialManager {
        private final String user;
        private final String password;
        private final String group;
        private final String role;

        StandardCredentialManager(String user, String password, String group, String role) {
            this.user = user;
            this.password = password;
            this.group = group;
            this.role = role;
        }

        public int getCredentialType() { return CLIENT_CREDENTIAL_TYPE_STD; }
        public String[] getCredentials(InvalidCredentialsException ignored) { return new String[] { user, password, group, role }; }
        public void setUserPassword(String user, String password, String ignored) { }
        public void setGroupRole(String group, String role) { }
    }
}

/** Erro de aplicacao transportado no envelope (status "error"). */
final class SoaError extends Exception {
    final String code;

    SoaError(String code, String message) {
        super(message);
        this.code = code;
    }
}

/**
 * JSON minimo para o protocolo do adaptador: parser restrito (objeto, array,
 * string, numero, booleano, null) e escritor com escape UTF-8 correto. Nada
 * aqui serializa objetos arbitrarios por reflexao; a saida e sempre construida
 * com DTOs (Map/List/String/Number/Boolean/null) explicitos.
 */
final class SoaJson {
    private SoaJson() {}

    static final class Request {
        final String action;
        final String correlationId;
        final String profile;
        final Map<String, Object> params;

        Request(String action, String correlationId, String profile, Map<String, Object> params) {
            this.action = action;
            this.correlationId = correlationId;
            this.profile = profile;
            this.params = params;
        }
    }

    static Request parseRequest(String text) throws SoaError {
        Object root;
        try {
            root = new Parser(text).parse();
        } catch (SoaError error) {
            throw error;
        } catch (RuntimeException error) {
            throw new SoaError("invalid_request", "JSON de requisicao invalido");
        }
        if (!(root instanceof Map<?, ?> map)) {
            throw new SoaError("invalid_request", "requisicao deve ser um objeto JSON");
        }
        String action = asString(map.get("action"));
        if (action == null) {
            throw new SoaError("invalid_request", "action ausente na requisicao");
        }
        String correlationId = asString(map.get("correlationId"));
        String profile = asString(map.get("profile"));
        Map<String, Object> params = new LinkedHashMap<>();
        Object rawParams = map.get("params");
        if (rawParams != null) {
            if (!(rawParams instanceof Map<?, ?> rawMap)) {
                throw new SoaError("invalid_request", "params deve ser um objeto JSON");
            }
            for (Map.Entry<?, ?> entry : rawMap.entrySet()) {
                if (!(entry.getKey() instanceof String key)) {
                    throw new SoaError("invalid_request", "chave de params deve ser string");
                }
                Object value = entry.getValue();
                if (value == null || value instanceof String || value instanceof Number
                        || value instanceof Boolean || value instanceof List<?>) {
                    params.put(key, value);
                } else {
                    throw new SoaError("invalid_request", "parametro com tipo nao suportado: " + key);
                }
            }
        }
        return new Request(action, correlationId, profile, params);
    }

    private static String asString(Object value) {
        return value instanceof String text ? text : null;
    }

    static String buildEnvelope(String action, String correlationId, long startedNanos,
            String status, Object result, String errorCode, String errorMessage,
            Boolean truncated, List<?> warnings, List<?> partialErrors) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schemaVersion", 1);
        envelope.put("operation", action == null ? "" : action);
        envelope.put("status", status);
        envelope.put("correlationId", correlationId == null ? "" : correlationId);
        envelope.put("durationMs", (System.nanoTime() - startedNanos) / 1_000_000L);
        if (errorCode != null || errorMessage != null) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("code", errorCode == null ? "internal" : errorCode);
            error.put("message", errorMessage == null ? "" : errorMessage);
            envelope.put("error", error);
        }
        if (result != null) envelope.put("result", result);
        if (truncated != null && truncated) envelope.put("truncated", true);
        if (warnings != null && !warnings.isEmpty()) envelope.put("warnings", warnings);
        if (partialErrors != null && !partialErrors.isEmpty()) {
            envelope.put("partialErrors", partialErrors);
        }
        return write(envelope);
    }

    static String write(Object value) {
        StringBuilder out = new StringBuilder();
        writeValue(value, out);
        return out.toString();
    }

    private static void writeValue(Object value, StringBuilder out) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String text) {
            writeString(text, out);
        } else if (value instanceof Boolean bool) {
            out.append(bool);
        } else if (value instanceof Number number) {
            if (number instanceof Double d && (d.isNaN() || d.isInfinite())) {
                out.append("null");
            } else {
                out.append(number);
            }
        } else if (value instanceof Map<?, ?> map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) out.append(',');
                first = false;
                writeString(String.valueOf(entry.getKey()), out);
                out.append(':');
                writeValue(entry.getValue(), out);
            }
            out.append('}');
        } else if (value instanceof Iterable<?> iterable) {
            out.append('[');
            boolean first = true;
            for (Object item : iterable) {
                if (!first) out.append(',');
                first = false;
                writeValue(item, out);
            }
            out.append(']');
        } else {
            out.append("null");
        }
    }

    private static void writeString(String text, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }

    private static final class Parser {
        private final String text;
        private int index;

        Parser(String text) {
            this.text = text;
        }

        Object parse() throws SoaError {
            Object value = parseValue();
            skipWhitespace();
            if (index < text.length()) throw new SoaError("invalid_request", "conteudo apos o JSON");
            return value;
        }

        private void skipWhitespace() {
            while (index < text.length() && Character.isWhitespace(text.charAt(index))) index++;
        }

        private char peek() throws SoaError {
            if (index >= text.length()) throw new SoaError("invalid_request", "JSON inesperadamente curto");
            return text.charAt(index);
        }

        private Object parseValue() throws SoaError {
            skipWhitespace();
            char c = peek();
            return switch (c) {
                case '{' -> parseObject();
                case '[' -> parseArray();
                case '"' -> parseString();
                case 't' -> expectKeyword("true", Boolean.TRUE);
                case 'f' -> expectKeyword("false", Boolean.FALSE);
                case 'n' -> expectKeyword("null", null);
                default -> {
                    if (c == '-' || (c >= '0' && c <= '9')) yield parseNumber();
                    throw new SoaError("invalid_request", "token inesperado: " + c);
                }
            };
        }

        private Map<String, Object> parseObject() throws SoaError {
            index++; // {
            Map<String, Object> map = new LinkedHashMap<>();
            skipWhitespace();
            if (peek() == '}') {
                index++;
                return map;
            }
            while (true) {
                skipWhitespace();
                if (peek() != '"') throw new SoaError("invalid_request", "chave de objeto deve ser string");
                String key = parseString();
                skipWhitespace();
                if (peek() != ':') throw new SoaError("invalid_request", "esperado ':'");
                index++;
                map.put(key, parseValue());
                skipWhitespace();
                char c = peek();
                if (c == ',') {
                    index++;
                } else if (c == '}') {
                    index++;
                    return map;
                } else {
                    throw new SoaError("invalid_request", "esperado ',' ou '}'");
                }
            }
        }

        private List<Object> parseArray() throws SoaError {
            index++; // [
            List<Object> list = new ArrayList<>();
            skipWhitespace();
            if (peek() == ']') {
                index++;
                return list;
            }
            while (true) {
                list.add(parseValue());
                skipWhitespace();
                char c = peek();
                if (c == ',') {
                    index++;
                } else if (c == ']') {
                    index++;
                    return list;
                } else {
                    throw new SoaError("invalid_request", "esperado ',' ou ']'");
                }
            }
        }

        private String parseString() throws SoaError {
            index++; // aspas de abertura
            StringBuilder out = new StringBuilder();
            while (true) {
                if (index >= text.length()) throw new SoaError("invalid_request", "string nao fechada");
                char c = text.charAt(index++);
                if (c == '"') return out.toString();
                if (c == '\\') {
                    if (index >= text.length()) throw new SoaError("invalid_request", "escape incompleto");
                    char escaped = text.charAt(index++);
                    switch (escaped) {
                        case '"' -> out.append('"');
                        case '\\' -> out.append('\\');
                        case '/' -> out.append('/');
                        case 'b' -> out.append('\b');
                        case 'f' -> out.append('\f');
                        case 'n' -> out.append('\n');
                        case 'r' -> out.append('\r');
                        case 't' -> out.append('\t');
                        case 'u' -> {
                            if (index + 4 > text.length()) {
                                throw new SoaError("invalid_request", "unicode escape incompleto");
                            }
                            try {
                                out.append((char) Integer.parseInt(text.substring(index, index + 4), 16));
                            } catch (NumberFormatException error) {
                                throw new SoaError("invalid_request", "unicode escape invalido");
                            }
                            index += 4;
                        }
                        default -> throw new SoaError("invalid_request", "escape invalido: \\" + escaped);
                    }
                } else if (c < 0x20) {
                    throw new SoaError("invalid_request", "caractere de controle em string");
                } else {
                    out.append(c);
                }
            }
        }

        private Double parseNumber() throws SoaError {
            int start = index;
            if (peek() == '-') index++;
            while (index < text.length() && Character.isDigit(text.charAt(index))) index++;
            if (index < text.length() && text.charAt(index) == '.') {
                index++;
                while (index < text.length() && Character.isDigit(text.charAt(index))) index++;
            }
            if (index < text.length() && (text.charAt(index) == 'e' || text.charAt(index) == 'E')) {
                index++;
                if (index < text.length() && (text.charAt(index) == '+' || text.charAt(index) == '-')) index++;
                while (index < text.length() && Character.isDigit(text.charAt(index))) index++;
            }
            try {
                return Double.parseDouble(text.substring(start, index));
            } catch (NumberFormatException error) {
                throw new SoaError("invalid_request", "numero invalido");
            }
        }

        private Object expectKeyword(String keyword, Object value) throws SoaError {
            if (!text.startsWith(keyword, index)) {
                throw new SoaError("invalid_request", "token inesperado");
            }
            index += keyword.length();
            return value;
        }
    }
}
