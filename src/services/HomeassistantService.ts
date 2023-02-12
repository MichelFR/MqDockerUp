import DockerService from "./DockerService";
import ConfigService from "./ConfigService";

const config = ConfigService.getConfig();
const packageJson = require("../../../package.json");

export default class HomeassistantService {

    public static async publishAvailability(client: any, online: boolean) {
        const payload = online ? "online" : "offline";
        const topic = `${config.mqtt.topic}/availability`;

        this.publishMessage(client, topic, payload, true);
    }

    public static async publishConfigMessages(client: any) {
        const containers = await DockerService.listContainers();
        
        for (const container of containers) {
            const image = container.Config.Image.split(":")[0];
            const formatedImage = image.replace(/\//g, "_");
            const tag = container.Config.Image.split(":")[1];

            const topic = `homeassistant/sensor/${formatedImage}_${tag}/sensor/config`;
            const payload = this.createPayload("Docker Image", image, tag);
            console.debug(payload);
            this.publishMessage(client, topic, payload, true);
        }
    }

    public static async publishInitialMessages(client: any) {
        const containers = await DockerService.listContainers();
        
        for (const container of containers) {
            const image = container.Config.Image.split(":")[0];
            const formatedImage = image.replace(/\//g, "_");
            const tag = container.Config.Image.split(":")[1];

            const topic = `${config.mqtt.topic}/${formatedImage}`;
            const payload = image;
            this.publishMessage(client, topic, payload, true);
        }
    }

    public static async publishMessage(client: any, topic: string, payload: object|string, retain: boolean) {
        if (typeof payload != "string") {
            payload = JSON.stringify(payload);
        }

        client.publish(
            topic,
            payload,
            {retain: retain}
        );
    }


    public static createPayload(name: string, image: string, tag: string): object {
        const formatedImage = image.replace(/\//g, "_");

        return {
            "name": name,
            "unique_id": `${image+tag}`,
            "state_topic": `${config.mqtt.topic}/${formatedImage}`,
            "availability": [
            {
                "topic": `${config.mqtt.topic}/availability`
            }
            ],
            "device": {
            "manufacturer": "MqDockerUp",
            "model": `${image}:${tag}`,
            "name": image,
            "sw_version": packageJson.version,
            "sa": "docker",
            "identifiers": [
                `${image}_${tag}`
            ]
            },
            "icon": "mdi:docker"
        };
    }
}
