export { CuratorAgentDurableObject } from "../src/adapters/production/curator-agent";
export {
  ChannelHubDurableObject,
  WorkspaceHubDurableObject,
} from "../src/adapters/production/realtime-hubs";
export { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";

export default {
  fetch(): Response {
    return new Response("contract-test worker");
  },
};
