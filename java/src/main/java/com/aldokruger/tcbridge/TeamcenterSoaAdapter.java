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

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;

/**
 * Adaptador local, invocado pelo tc-bridge. Nao abre porta, nao recebe senha
 * por argumentos e aceita apenas as acoes declaradas abaixo.
 */
public final class TeamcenterSoaAdapter {
    private TeamcenterSoaAdapter() {}

    public static void main(String[] args) {
        try {
            Arguments arguments = Arguments.parse(args);
            String url = requiredEnv("TC_TEAMCENTER_URL");
            String user = requiredEnv("TC_TEAMCENTER_USER");
            String password = requiredEnv("TC_TEAMCENTER_PASSWORD");
            String group = env("TC_TEAMCENTER_GROUP");
            String role = env("TC_TEAMCENTER_ROLE");
            String locale = env("TC_TEAMCENTER_LOCALE", "en_US");

            Connection connection = new Connection(url, new StandardCredentialManager(user, password, group, role));
            connection.setApplicationName("tc-bridge");
            SessionService session = SessionService.getService(connection);
            session.login(user, password, group, role, locale);
            try {
                Object response = switch (arguments.action) {
                    case "session_info" -> session.getAvailableServices();
                    case "get_preferences" -> session.getPreferences(arguments.scope, parseStringArray(arguments.preferenceNames));
                    case "execute_saved_query" -> executeSavedQuery(connection, arguments);
                    default -> throw new IllegalArgumentException("Acao SOA nao permitida");
                };
                System.out.println(toJson(response, 0));
            } finally {
                session.logout();
            }
        } catch (Exception error) {
            System.err.println(safeMessage(error));
            System.exit(1);
        }
    }

    private static Object executeSavedQuery(Connection connection, Arguments arguments) throws Exception {
        DataManagementService dataManagement = DataManagementService.getService(connection);
        Method loadObjects = dataManagement.getClass().getMethod("loadObjects", String[].class);
        Object serviceData = loadObjects.invoke(dataManagement, (Object) new String[] { arguments.queryUid });
        Method getPlainObject = serviceData.getClass().getMethod("getPlainObject", int.class);
        Object modelObject = getPlainObject.invoke(serviceData, 0);
        if (!(modelObject instanceof ImanQuery query)) {
            throw new IllegalArgumentException("query_uid nao referencia um ImanQuery acessivel");
        }

        SavedQuery.SavedQueryInput input = new SavedQuery.SavedQueryInput();
        input.query = query;
        input.entries = parseStringArray(arguments.entries);
        input.values = parseStringArray(arguments.values);
        input.maxNumToReturn = arguments.limit;
        input.maxNumToInflate = arguments.limit;
        return SavedQueryService.getService(connection).executeSavedQueries(new SavedQuery.SavedQueryInput[] { input });
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " nao configurado");
        return value;
    }

    private static String env(String name) { return env(name, ""); }
    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null ? fallback : value;
    }

    private static String[] parseStringArray(String json) {
        if (json == null || json.length() < 2) return new String[0];
        List<String> values = new ArrayList<>();
        int index = 0;
        while (index < json.length()) {
            while (index < json.length() && (json.charAt(index) == '[' || json.charAt(index) == ']' || json.charAt(index) == ',' || Character.isWhitespace(json.charAt(index)))) index++;
            if (index >= json.length()) break;
            if (json.charAt(index) != '"') throw new IllegalArgumentException("Array JSON invalido");
            StringBuilder value = new StringBuilder();
            index++;
            while (index < json.length() && json.charAt(index) != '"') {
                char current = json.charAt(index++);
                if (current == '\\' && index < json.length()) {
                    char escaped = json.charAt(index++);
                    value.append(escaped == 'n' ? '\n' : escaped == 'r' ? '\r' : escaped == 't' ? '\t' : escaped);
                } else value.append(current);
            }
            if (index >= json.length()) throw new IllegalArgumentException("Array JSON invalido");
            index++;
            values.add(value.toString());
        }
        return values.toArray(String[]::new);
    }

    private static String toJson(Object value, int depth) {
        if (value == null) return "null";
        if (value instanceof String text) return jsonString(text);
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof ModelObject object) return "{\"uid\":" + jsonString(object.getUid()) + "}";
        if (depth >= 4) return jsonString("[truncated]");
        if (value.getClass().isArray()) {
            int length = Math.min(Array.getLength(value), 200);
            StringBuilder result = new StringBuilder("[");
            for (int i = 0; i < length; i++) {
                if (i > 0) result.append(',');
                result.append(toJson(Array.get(value, i), depth + 1));
            }
            return result.append(']').toString();
        }
        StringBuilder result = new StringBuilder("{");
        int count = 0;
        for (Field field : value.getClass().getFields()) {
            if (Modifier.isStatic(field.getModifiers()) || count >= 50) continue;
            try {
                if (count++ > 0) result.append(',');
                result.append(jsonString(field.getName())).append(':').append(toJson(field.get(value), depth + 1));
            } catch (IllegalAccessException ignored) { }
        }
        return result.append('}').toString();
    }

    private static String jsonString(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n") + "\"";
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null ? error.getClass().getSimpleName() : message.replaceAll("(?i)password=[^\\s]+", "password=[redacted]");
    }

    private static final class StandardCredentialManager implements CredentialManager {
        private String user;
        private String password;
        private String group;
        private String role;

        StandardCredentialManager(String user, String password, String group, String role) {
            setUserPassword(user, password, "");
            setGroupRole(group, role);
        }

        public int getCredentialType() { return CLIENT_CREDENTIAL_TYPE_STD; }
        public String[] getCredentials(InvalidCredentialsException ignored) { return new String[] { user, password, group, role }; }
        public String[] getCredentials(com.teamcenter.schemas.soa._2006_03.exceptions.InvalidUserException ignored) { return new String[] { user, password, group, role }; }
        public void setUserPassword(String user, String password, String ignored) { this.user = user; this.password = password; }
        public void setGroupRole(String group, String role) { this.group = group; this.role = role; }
    }

    private static final class Arguments {
        String action;
        String scope = "";
        String preferenceNames;
        String queryUid;
        String entries;
        String values;
        int limit = 50;

        static Arguments parse(String[] args) {
            Arguments parsed = new Arguments();
            for (int i = 0; i < args.length; i += 2) {
                if (i + 1 >= args.length) throw new IllegalArgumentException("Argumento sem valor: " + args[i]);
                switch (args[i]) {
                    case "--action" -> parsed.action = args[i + 1];
                    case "--scope" -> parsed.scope = args[i + 1];
                    case "--preference-names" -> parsed.preferenceNames = args[i + 1];
                    case "--query-uid" -> parsed.queryUid = args[i + 1];
                    case "--entries" -> parsed.entries = args[i + 1];
                    case "--values" -> parsed.values = args[i + 1];
                    case "--limit" -> parsed.limit = Integer.parseInt(args[i + 1]);
                    default -> throw new IllegalArgumentException("Argumento nao permitido: " + args[i]);
                }
            }
            if (parsed.action == null) throw new IllegalArgumentException("--action e obrigatorio");
            return parsed;
        }
    }
}
