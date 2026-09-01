export const MAIN_WIRE = {
  REQUEST: "main:request",
  RESPONSE: "main:response",
  EVENT: "main:event",
} as const;

export const MAIN_CHANNELS = {
  APP_OPEN_EXTERNAL: "app:open-external",
  APP_OPEN_PROJECT_EDITOR: "app:open-project-editor",
  APP_SHOW_IN_FOLDER: "app:show-in-folder",
  AGENT_GET_STATUS: "agent:get-status",
  AGENT_SET_ACTIVE_PROJECT: "agent:set-active-project",
  AGENT_SELECT: "agent:select",
  AGENT_INSTALL_CLI: "agent:install-cli",
  AGENT_INSTALL_MCP: "agent:install-mcp",
  AGENT_INSTALL_SKILL: "agent:install-skill",
  AGENT_LAUNCH: "agent:launch",
  AGENT_TEST_CONNECTION: "agent:test-connection",
  AGENT_RECORD_ACTIVITY: "agent:record-activity",
  AGENT_RESET: "agent:reset",
  AUTH_GET_STATE: "auth:get-state",
  AUTH_SIGN_IN: "auth:sign-in",
  AUTH_SIGN_OUT: "auth:sign-out",
  CLOUD_REQUEST: "cloud:request",
  CLOUD_UPLOAD_FILE: "cloud:upload-file",
  AUTH_GET_PENDING_CALLBACK: "auth:get-pending-callback",
  CHECKOUT_GET_PENDING_CALLBACK: "checkout:get-pending-callback",
  WINDOW_IS_FULLSCREEN: "window:is-fullscreen",
  WINDOW_CAPTURE: "window:capture",
  FILE_TRANSFER: "file:transfer",
  FILE_PICK_EXPORT: "file:pick-export",
  FILE_AUTHORIZE_CLI_EXPORT: "file:authorize-cli-export",
  FILE_AUTHORIZE_CLI_MEDIA: "file:authorize-cli-media",
  FILE_WRITE_OPEN: "file:write-open",
  FILE_WRITE_CHUNK: "file:write-chunk",
  FILE_WRITE_CLOSE: "file:write-close",
  FILE_WRITE_ABORT: "file:write-abort",
  HEADLESS_GET_MODE: "headless:get-mode",
  LOGS_GET: "logs:get",
  PROJECTS_PICK_ROOT: "projects:pick-root",
  PROJECTS_DEFAULT_ROOT: "projects:default-root",
  PROJECTS_ENSURE_DEFAULT: "projects:ensure-default",
  PROJECTS_LIST: "projects:list",
  PROJECTS_GET: "projects:get",
  PROJECTS_INIT: "projects:init",
  PROJECTS_RESOLVE: "projects:resolve",
  PROJECTS_CREATE: "projects:create",
  PROJECTS_RENAME: "projects:rename",
  PROJECTS_DUPLICATE: "projects:duplicate",
  PROJECTS_DELETE: "projects:delete",
  PROJECTS_COMPILE: "projects:compile",
  PROJECTS_WRITE: "projects:write",
  PROJECTS_WATCH: "projects:watch",
  PROJECTS_UNWATCH: "projects:unwatch",
  PROJECTS_MANIFEST_READ: "projects:manifest-read",
  PROJECTS_MANIFEST_WRITE: "projects:manifest-write",
  PROJECTS_CONFIG_READ: "projects:config-read",
  PROJECTS_CONFIG_WRITE: "projects:config-write",
  PROJECTS_SOURCE_READ: "projects:source-read",
  PROJECTS_SOURCE_WRITE: "projects:source-write",
  PROJECTS_REVISIONS_LIST: "projects:revisions-list",
  PROJECTS_REVISIONS_READ: "projects:revisions-read",
  PROJECTS_REVISIONS_RESTORE: "projects:revisions-restore",
  PROJECTS_FS_LIST: "projects:fs-list",
  PROJECTS_FS_STAT: "projects:fs-stat",
  PROJECTS_FS_FILE: "projects:fs-file",
  PROJECTS_FS_WRITE: "projects:fs-write",
  PROJECTS_FS_COPY: "projects:fs-copy",
  PROJECTS_FS_REMOVE: "projects:fs-remove",
  PROJECTS_FS_REAL_PATH: "projects:fs-real-path",
  AUTH_CALLBACK: "auth:callback",
  CHECKOUT_CALLBACK: "checkout:callback",
  WINDOW_FULLSCREEN_CHANGE: "window:fullscreen-change",
  HEADLESS_MODE: "headless:mode",
  PROJECTS_CHANGED: "projects:changed",
  PROJECTS_SOURCE_CHANGED: "projects:source-changed",
  AUTH_STATE_CHANGED: "auth:state-changed",
  CLOUD_UPLOAD_PROGRESS: "cloud:upload-progress",
  AGENT_CONNECTION_CHANGED: "agent:connection-changed",
} as const;

export type MainChannel = (typeof MAIN_CHANNELS)[keyof typeof MAIN_CHANNELS];

export type MainRequest = {
  id: string;
  channel: MainChannel;
  data: unknown;
};

export type MainReply =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string };

export type MainEvent = {
  channel: MainChannel;
  data: unknown;
};
