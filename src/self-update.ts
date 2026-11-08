import Docker from "dockerode";
import SelfUpdateService from "./services/SelfUpdateService";

// Do not import index or application services here: the helper must not open
// MQTT or the application database while the old instance is shutting down.
SelfUpdateService.replace(new Docker({timeout: 45000}), process.argv[2], process.argv[3])
  .then(() => { console.info("MqDockerUp self-update completed"); process.exit(0); })
  .catch(error => { console.error("MqDockerUp self-update failed:", error); process.exit(1); });
