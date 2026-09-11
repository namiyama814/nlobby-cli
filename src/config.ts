function getPlatformUserAgent(): string {
  const platform = typeof process === "undefined" ? "linux" : process.platform;

  switch (platform) {
    case "darwin":
      return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
    case "win32":
      return "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
    case "linux":
    default:
      return "Mozilla/5.0 (X11; CrOS x86_64 10066.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
  }
}

export const CONFIG = {
  nlobby: {
    baseUrl:
      typeof process !== "undefined"
        ? process.env.NLOBBY_BASE_URL || "https://nlobby.nnn.ed.jp"
        : "https://nlobby.nnn.ed.jp",
  },
  mcp: {
    serverName:
      typeof process !== "undefined"
        ? process.env.MCP_SERVER_NAME || "nlobby-cli"
        : "nlobby-cli",
    serverVersion:
      typeof process !== "undefined"
        ? process.env.MCP_SERVER_VERSION || "1.6.0"
        : "1.6.0",
  },
  userAgent:
    typeof process !== "undefined"
      ? process.env.USER_AGENT || getPlatformUserAgent()
      : getPlatformUserAgent(),
} as const;
