import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { kookPlugin } from "./src/channel.js";
import { setKookRuntime } from "./src/runtime.js";

export { monitorKookProvider } from "./src/monitor.js";
export { sendKookMessage, updateKookMessage, deleteKookMessage, sendKookCardMessage } from "./src/send.js";
export { uploadMediaKook, sendMediaKook } from "./src/media.js";
export { probeKook } from "./src/probe.js";
export { addReactionKook, removeReactionKook } from "./src/reactions.js";
export { kookPlugin } from "./src/channel.js";

const plugin = {
  id: "kook",
  name: "KOOK",
  description: "KOOK (开黑啦) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setKookRuntime(api.runtime);
    api.registerChannel({ plugin: kookPlugin });
  },
};

export default plugin;
