<!-- ![DALL·E 2023-10-17 21 46 04 - Vector concept featuring the MQTT and Docker logos as puzzle pieces fitting together  Lines or arrows indicate the flow of data and updates between th](https://github.com/MichelFR/MqDockerUp/assets/7061122/e0d28e1c-5478-4b99-a885-1f7298876956) -->
<center><img height=350 alt="image" src="https://github.com/user-attachments/assets/cb264d67-7d72-4527-9a27-4599a6f9d1c2"></center>

<br>

[![Create Release](https://github.com/MichelFR/MqDockerUp/actions/workflows/release-checker.yml/badge.svg?branch=main)](https://github.com/MichelFR/MqDockerUp/actions/workflows/release-checker.yml)

# MqDockerUp
MqDockerUp is a tool that allows you to monitor and update your docker containers using MQTT and homeassistant. It can publish information about your containers, such as name, status, image, ports, etc., to an MQTT broker, and create or update corresponding entities in homeassistant. You can also send commands to start, stop, restart, or remove your containers via MQTT or homeassistant. It even creates update entities in Homeassistant to make it easy to update you running containers. MqDockerUp is easy to set up and configure, and supports multiple platforms and architectures. With MqDockerUp, you can have a unified and convenient way to manage your docker containers from anywhere.


## How it works

MqDockerUp uses Docker APIs to get information about containers and images. It then makes a request to the Docker Hub API to get information about the latest image tags. If there is a new version, it will publish the change to a specified MQTT broker.

## How to use

### Standalone application

1. Clone the repository and install dependencies with`npm install`.
2. Change the`config.yaml` file with your desired configuration.
3. Run the project with`npm run start`.

### Docker
 * [`Docker run`](#run)
 * [`Docker Compose/Docker-compose`](#compose)

## Configuration

The configuration file `config.yaml` (`\app\config.yaml` in docker the container) contains the following sections:

### Main Configuration

The main configuration is specified in the `main` section of `config.yaml`:

|                  Name |   Enviromental Variable    | Type     | Default  | Description                                                                                                                                                                                |
| --------------------: | :------------------------: | :------- | :------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|            `interval` |      `MAIN_INTERVAL`       | `string` |   `5m`   | The interval at which container are checked and published/republished to the MQTT broker, must be in the format`[number][unit]`, where `[number]` is a positive integer and `[unit]`.      |
| `imageUpdateInterval` | `MAIN_IMAGEUPDATEINTERVAL` | `string` |   `1h`   | The interval at which updates are checked and published/republished to the MQTT broker, must be in the format`[number][unit]`, where `[number]` is a positive integer and `[unit]`.        |
|              `prefix` |       `MAIN_PREFIX`        | `string` | Optional | Parameter specifies a prefix to add to the MQTT topic when publishing updates. Enabling you to have multiple instances of MqDockerUp publishing to the same MQTT broker without conflicts. |



### `[Unit]`

|    __Unit__ |   `s`   |   `m`   |  `h`  | `d`  |  `w`  |
| ----------: | :-----: | :-----: | :---: | :--: | :---: |
| __Meaning__ | Seconds | Minutes | Hours | Days | Weeks |



### MQTT Configuration

The MQTT configuration is specified in the `mqtt` section of `config.yaml`:

|               Name |  Enviromental Variable  |   Type    |         Default         | Description                                                                                             |
| -----------------: | :---------------------: | :-------: | :---------------------: | :------------------------------------------------------------------------------------------------------ |
|    `connectionUri` |  `MQTT_CONNECTIONURI`   | `string`  | `mqtt://127.0.0.1:1883` | The URL of the MQTT broker to connect to.                                                               |
|            `topic` |      `MQTT_TOPIC`       | `string`  |      `mqdockerup`       | The MQTT topic to publish updates to.                                                                   |
| `discovery_prefix` | `MQTT_DISCOVERY_PREFIX` | `string`  |     `homeassistant`     | The Prefix chosen in HA as `discovery prefix` (change only if you changed it in HA)                     |
|         `clientId` |     `MQTT_CLIENTID`     | `string`  |      `mqdockerup`       | The MQTT client ID to use when connecting to the broker.                                                |
|         `username` |     `MQTT_USERNAME`     | `string`  |          `ha`           | The username to use when connecting to the MQTT broker.                                                 |
|         `password` |     `MQTT_PASSWORD`     | `string`  |        Optional         | The password to use when connecting to the MQTT broker.                                                 |
|        `ha_legacy` |    `MQTT_HA_LEGACY`     | `boolean` |         `false`         | The way MqDockerUp creates the update entity, `false` for HA 2024.11+ and `true` for previous versions. |
|   `connectTimeout` |  `MQTT_CONNECTTIMEOUT`  |   `int`   |          `60`           | The maximum time, in seconds, to wait for a successful connection to the MQTT broker.                   |
|  `protocolVersion` | `MQTT_PROTOCOLVERSION`  |   `int`   |           `5`           | The MQTT protocol version to use when connecting to the broker.                                         |




### Access Tokens Configuration

The access tokens configuration is specified in the `accessTokens` section of `config.yaml`:

|        Name |  Enviromental Variable   |   Type   |  Default  | Description                                                                                            |
| ----------: | :----------------------: | :------: | :-------: | :----------------------------------------------------------------------------------------------------- |
| `dockerhub` | `ACCESSTOKENS_DOCKERHUB` | `string` | Optional* | The Dockerhub token, used to avoid the limitations of the DockerHub API *_⚠️Still Work In Progress_. |
|    `github` |  `ACCESSTOKENS_GITHUB`   | `string` | Optional* | The Github token, used to manage images on GitHub (`ghcr.io`) *_⚠️Needed for this type of images_.   |


### Ignore Configuration

The ignore configuration is specified in the `ignore` section of `config.yaml`:

|         Name | Enviromental Variable |   Type   | Default  | Description                                                          |
| -----------: | :-------------------: | :------: | :------: | :------------------------------------------------------------------- |
| `containers` |  `IGNORE_CONTAINERS`  | `string` | Optional | A comma separated list of container to be ignored.                   |
|    `updates` |   `IGNORE_UPDATES`    | `string` | Optional | A comma separated list of container which updates should be ignored. |



## Config Examples

### <a name="yaml"></a> `config.yaml`
Here some examples with all config defaults:
```yaml
main:
  interval: "5m"
  imageUpdateInterval: "1h"
  prefix: ""
mqtt:
  connectionUri: "mqtt://127.0.0.1:1883"
  topic: "mqdockerup"
  discovery_prefix: "homeassistant"
  clientId: "mqdockerup"
  username: "ha"
  password: "12345678"
  ha_legacy: false
  connectTimeout: 60
  protocolVersion: 5
accessTokens:
  dockerhub: "" # - currently not supported
  github: ""
ignore:
  containers: "some,container"
  updates: "other,container"
```
You can also use environment variables to override the values in the config file. The environment variables must have the same name as the config keys, but in uppercase and with underscores instead of dots.
For example, to override the `mqtt.connectionUri` value, you can set the `MQTT_CONNECTIONURI` environment variable. 
Here some examples with all variables defaults:

### <a name="run"></a>Docker run

```bash
docker run -d \
  --restart always \
  --name mqdockerup \
  -e MAIN_INTERVAL="5m" \
  -e MAIN_IMAGEUPDATEINTERVAL="1h" \
  -e MAIN_PREFIX="" \
  -e MQTT_CONNECTIONURI="mqtt=//127.0.0.1=1883" \
  -e MQTT_TOPIC="mqdockerup" \
  -e MQTT_DISCOVERY_PREFIX="homeassistant" \
  -e MQTT_CLIENTID="mqdockerup" \
  -e MQTT_USERNAME="ha" \
  -e MQTT_PASSWORD="" \
  -e MQTT_HA_LEGACY=false \
  -e MQTT_CONNECTTIMEOUT=60 \
  -e MQTT_PROTOCOLVERSION=5 \
  -e ACCESSTOKENS_DOCKERHUB="" \
  -e ACCESSTOKENS_GITHUB="" \
  -e IGNORE_CONTAINERS="" \
  -e IGNORE_UPDATES="" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v your/path/data:/app/data/ \
  micrib/mqdockerup:latest
```

### <a name="compose"></a>Docker Compose

```yaml
services:
  mqdockerup:
    image: micrib/mqdockerup:latest
    restart: always
    environment:
      MAIN_INTERVAL: "5m"
      MAIN_IMAGEUPDATEINTERVAL: "1h"
      MAIN_PREFIX: ""
      MQTT_CONNECTIONURI: "mqtt://127.0.0.1:1883"
      MQTT_TOPIC: "mqdockerup"
      MQTT_DISCOVERY_PREFIX: "homeassistant"
      MQTT_CLIENTID: "mqdockerup"
      MQTT_USERNAME: "ha"
      MQTT_PASSWORD: ""
      MQTT_HA_LEGACY : false
      MQTT_CONNECTTIMEOUT: 60
      MQTT_PROTOCOLVERSION: 5
      ACCESSTOKENS_DOCKERHUB: ""
      ACCESSTOKENS_GITHUB: ""
      IGNORE_CONTAINERS: ""
      IGNORE_UPDATES: ""
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock # This is required to access the docker API
      - your/path/data:/app/data/ # This is required to store the data (database.db)
    container_name: mqdockerup
```

## Labels

You can use some of these labels on individual containers to apply to them the effect written in the description.


|                          Name |   Type    | Default  | Description                                                                               |
| ----------------------------: | :-------: | :------: | :---------------------------------------------------------------------------------------- |
| `mqdockerup.ignore_container` | `boolean` | Optional | `true` to ignore the container that have this label, `false` to not ignore                |
|   `mqdockerup.ignore_updates` | `boolean` | Optional | `true` to ignore the updates of the container that have this label, `false` to not ignore |


## Screenshots

![image](https://github.com/user-attachments/assets/f6f78bdb-4f7d-4080-8588-63fdaafa1e51)
<img width="600" alt="image" src="https://user-images.githubusercontent.com/7061122/221386530-d5168c26-8ead-4418-9ab4-84ad6ff91ba9.png">

## Contribute

This project is open source and contributions are welcome. If you have any ideas or suggestions, please open an issue or a pull request.
