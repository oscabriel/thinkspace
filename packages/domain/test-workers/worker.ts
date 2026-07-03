export { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";

export default {
  fetch(): Response {
    return new Response("contract-test worker");
  },
};
