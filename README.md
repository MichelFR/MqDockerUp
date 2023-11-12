[![Create Release](https://github.com/MichelFR/MqDockerUp/actions/workflows/release-checker.yml/badge.svg?branch=main)](https://github.com/MichelFR/MqDockerUp/actions/workflows/release-checker.yml)

<img width="500" alt="image" src="https://user-images.githubusercontent.com/7061122/221386530-d5168c26-8ead-4418-9ab4-84ad6ff91ba9.png">

![DALL·E 2023-10-17 21 46 04 - Vector concept featuring the MQTT and Docker logos as puzzle pieces fitting together  Lines or arrows indicate the flow of data and updates between th](https://github.com/MichelFR/MqDockerUp/assets/7061122/e0d28e1c-5478-4b99-a885-1f7298876956)


# MqDockerUp

MqDockerUp is a tool that allows you to monitor and update your docker containers using MQTT and homeassistant. It can publish information about your containers, such as name, status, image, ports, etc., to an MQTT broker, and create or update corresponding entities in homeassistant. You can also send commands to start, stop, restart, or remove your containers via MQTT or homeassistant. It even creates update entities in Homeassistant to make it easy to update you running containers. MqDockerUp is easy to set up and configure, and supports multiple platforms and architectures. With MqDockerUp, you can have a unified and convenient way to manage your docker containers from anywhere.

## How it works

MqDockerUp uses Docker APIs to get information about containers and images. It then makes a request to the Docker Hub API to get information about the latest image tags. If there is a new version, it will publish the change to a specified MQTT broker.

## How to use

### Standalone application

1. Clone the repository and install dependencies with `npm install`.
2. Change the `config.yaml` file with your desired configuration.
3. Run the project with `npm run start`.

### Docker command

```bash
docker run -d \
  --restart always \
  --name mqdockerup \
  -e MAIN_INTERVAL="5m" \
  -e MQTT_CONNECTIONURI="mqtt://127.0.0.1:1883" \
  -e MQTT_USERNAME="ha" \
  -e MQTT_PASSWORD="12345678" \
  -e ACCESSTOKENS_GITHUB="" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v your/path/data:/app/data/ \
  micrib/mqdockerup:latest
```


### Docker Compose
```yaml
version: '3.9'

services:
  mqdockerup:
    image: micrib/mqdockerup:latest
    restart: always
    environment:
      MAIN_INTERVAL: "5m"
      MQTT_CONNECTIONURI: "mqtt://127.0.0.1:1883"
      MQTT_USERNAME: "ha"
      MQTT_PASSWORD: "12345678"
      ACCESSTOKENS_GITHUB: ""
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock # This is required to access the docker API	
      - your/path/data:/app/data/ # This is required to store the data (database.db)
    container_name: mqdockerup
```

## Configuration

The configuration file `config.yaml` contains the following sections:

### Main Configuration
The main configuration is specified in the `main` section:
```yaml
main:
  interval: "5m"
```
The `interval` parameter specifies the frequency at which updates are checked and published to the MQTT broker. The interval must be in the format `[number][unit]`, where `[number]` is a positive integer and `[unit]` is one of `s` (seconds), `m` (minutes), `h` (hours), `d` (days), or `w` (weeks).

### MQTT Configuration
The MQTT configuration is specified in the `mqtt` section:
```yaml
mqtt:
  connectionUri: "mqtt://localhost:1883"
  topic: "mqdockerup"
  clientId: "mqdockerup"
  username: "ha"
  password: "12345678"
  connectTimeout: 60
  protocolVersion: 5
```
The `mqtt` section contains the following parameters:

- `connectionUri`: The URL of the MQTT broker to connect to.
- `topic`: The MQTT topic to publish updates to.
- `clientId`: The MQTT client ID to use when connecting to the broker.
- `username`: The username to use when connecting to the MQTT broker.
- `password`: The password to use when connecting to the MQTT broker.
- `connectTimeout`: The maximum time, in seconds, to wait for a successful connection to the MQTT broker.
- `protocolVersion`: The MQTT protocol version to use when connecting to the broker.

### Access Tokens Configuration
The access tokens configuration is specified in the `accessTokens` section:
```yaml
accessTokens:
  dockerhub: - currently not supported
  github:
```
The `accessTokens` section is used to provide tokens for Dockerhub and GitHub.


## Environment Variables

You can also use environment variables to override the values in the config file. The environment variables must have the same name as the config keys, but in uppercase and with underscores instead of dots. For example, to override the `mqtt.connectionUri` value, you can set the `MQTT_CONNECTIONURI` environment variable. Here is the list of environment variables that you can use:

- `MAIN_INTERVAL`: The interval at which updates are checked and published to the MQTT broker.
- `MQTT_CONNECTIONURI`: The URL of the MQTT broker to connect to.
- `MQTT_TOPIC`: The MQTT topic to publish updates to.
- `MQTT_CLIENTID`: The MQTT client ID to use when connecting to the broker.
- `MQTT_USERNAME`: The username to use when connecting to the MQTT broker.
- `MQTT_PASSWORD`: The password to use when connecting to the MQTT broker.
- `MQTT_CONNECTTIMEOUT`: The maximum time, in seconds, to wait for a successful connection to the MQTT broker.
- `MQTT_PROTOCOLVERSION`: The MQTT protocol version to use when connecting to the broker.
- `ACCESSTOKENS_DOCKERHUB`: The Dockerhub token.
- `ACCESSTOKENS_GITHUB`: The Github token.

## Screenshots
![image](https://user-images.githubusercontent.com/7061122/218336295-a040936a-20f3-48da-8835-d9c6746fc8f6.png)




## Contribute

This project is open source and contributions are welcome. If you have any ideas or suggestions, please open an issue or a pull request.
