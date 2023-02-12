[![Docker Image Build & Deploy](https://github.com/MichelFR/MqDockerUp/actions/workflows/docker-image.yml/badge.svg)](https://github.com/MichelFR/MqDockerUp/actions/workflows/docker-image.yml)
[![Create Release](https://github.com/MichelFR/MqDockerUp/actions/workflows/release-cehcker.yml/badge.svg?branch=main)](https://github.com/MichelFR/MqDockerUp/actions/workflows/release-cehcker.yml)
# MqDockerUp

MqDockerUp is a tool that allows you to monitor and update your docker containers using MQTT and homeassistant. It can publish information about your containers, such as name, status, image, ports, etc., to an MQTT broker, and create or update corresponding entities in homeassistant. You can also send commands to start, stop, restart, or remove your containers via MQTT or homeassistant. It even creates update entities in Homeassistant to make it easy to update you running containers. MqDockerUp is easy to set up and configure, and supports multiple platforms and architectures. With MqDockerUp, you can have a unified and convenient way to manage your docker containers from anywhere.

## How it works

MqDockerUp uses Docker APIs to get information about containers and images. It then makes a request to the Docker Hub API to get information about the latest image tags. If there is a new version, it will publish the change to a specified MQTT broker.

## How to use

### Standalone application

1. Clone the repository and install dependencies with `npm install`.
2. Change the `config.yaml` file with your desired configuration.
3. Run the project with `npm run start`.

### Docker container

1. Pull the image from Docker Hub with `docker pull micrib/mqdockerup`.
2. Mount the docker.sock file to the container with `docker run -v /var/run/docker.sock:/var/run/docker.sock micrib/mqdockerup`.
3. Optionally, you can use environment variables to override the values in the config file. See the [Environment Variables](#environment-variables) section for more details.

## Configuration

The configuration file `config.yaml` contains the following sections:

### Main Configuration
The main configuration is specified in the `main` section:
```yaml
main:
  interval: "15m"
```
The `interval` parameter specifies the frequency at which updates are checked and published to the MQTT broker. The interval must be in the format `[number][unit]`, where `[number]` is a positive integer and `[unit]` is one of `s` (seconds), `m` (minutes), `h` (hours), `d` (days), or `w` (weeks).

### MQTT Configuration
The MQTT configuration is specified in the `mqtt` section:
```yaml
mqtt:
  ha_discovery: true
  connectionUri: "mqtt://localhost:1883"
  topic: "mqdockerup"
  clientId: "mqdockerup"
  username: "ha"
  password: "12345678"
  connectTimeout: 60
  protocolVersion: 5
  qos: 2
  retain: false
```
The `mqtt` section contains the following parameters:

- `ha_discovery`: Specifies whether or not to enable Home Assistant discovery.
- `connectionUri`: The URL of the MQTT broker to connect to.
- `topic`: The MQTT topic to publish updates to.
- `clientId`: The MQTT client ID to use when connecting to the broker.
- `username`: The username to use when connecting to the MQTT broker.
- `password`: The password to use when connecting to the MQTT broker.
- `connectTimeout`: The maximum time, in seconds, to wait for a successful connection to the MQTT broker.
- `protocolVersion`: The MQTT protocol version to use when connecting to the broker.
- `qos`: The MQTT Quality of Service level to use when publishing updates.
- `retain`: Specifies whether or not to retain the latest update when publishing to the MQTT broker.

## Environment Variables

You can also use environment variables to override the values in the config file. The environment variables must have the same name as the config keys, but in uppercase and with underscores instead of dots. For example, to override the `mqtt.connectionUri` value, you can set the `MQTT_CONNECTIONURI` environment variable. Here is the list of environment variables that you can use:

- `MAIN_INTERVAL`: The interval at which updates are checked and published to the MQTT broker.
- `MQTT_HA_DISCOVERY`: Specifies whether or not to enable Home Assistant discovery.
- `MQTT_CONNECTIONURI`: The URL of the MQTT broker to connect to.
- `MQTT_TOPIC`: The MQTT topic to publish updates to.
- `MQTT_CLIENTID`: The MQTT client ID to use when connecting to the broker.
- `MQTT_USERNAME`: The username to use when connecting to the MQTT broker.
- `MQTT_PASSWORD`: The password to use when connecting to the MQTT broker.
- `MQTT_CONNECTTIMEOUT`: The maximum time, in seconds, to wait for a successful connection to the MQTT broker.
- `MQTT_PROTOCOLVERSION`: The MQTT protocol version to use when connecting to the broker.
- `MQTT_QOS`: The MQTT Quality of Service level to use when publishing updates.
- `MQTT_RETAIN`: Specifies whether or not to retain the latest update when publishing to the MQTT broker.

## Screenshots
![image](https://user-images.githubusercontent.com/7061122/218336219-2c6337ac-f0df-4b8f-9d92-3b0085af98c7.png)
![image](https://user-images.githubusercontent.com/7061122/218336295-a040936a-20f3-48da-8835-d9c6746fc8f6.png)




## Contribute

This project is open source and contributions are welcome. If you have any ideas or suggestions, please open an issue or a pull request.
