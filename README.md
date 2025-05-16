<!-- ![DALL·E 2023-10-17 21 46 04 - Vector concept featuring the MQTT and Docker logos as puzzle pieces fitting together  Lines or arrows indicate the flow of data and updates between th](https://github.com/MichelFR/MqDockerUp/assets/7061122/e0d28e1c-5478-4b99-a885-1f7298876956) -->
<center><img alt="image" src="https://github.com/user-attachments/assets/cb264d67-7d72-4527-9a27-4599a6f9d1c2"></center>

<br>

[![Create Release](https://github.com/MichelFR/MqDockerUp/actions/workflows/release-checker.yml/badge.svg?branch=main)](https://github.com/MichelFR/MqDockerUp/actions/workflows/release-checker.yml)

# MqDockerUp
MqDockerUp is a tool that allows you to monitor and update your docker containers using MQTT and homeassistant. It can publish information about your containers, such as name, status, image, ports, etc., to an MQTT broker, and create or update corresponding entities in homeassistant. You can also send commands to start, stop, restart, or remove your containers via MQTT or homeassistant. It even creates update entities in Homeassistant to make it easy to update you running containers. MqDockerUp is easy to set up and configure, and supports multiple platforms and architectures. With MqDockerUp, you can have a unified and convenient way to manage your docker containers from anywhere.


## How it works

MqDockerUp uses various Docker Registry APIs (DockerHub/GHCR/LSCR) to get information about containers and images. It then makes a request to the Docker Hub API to get information about the latest image tags. If there is a new version, it will publish the change to a specified MQTT broker.

## How to use

### Standalone application

1. Clone the repository and install dependencies with`npm install`.
2. Change the`config.yaml` file with your desired configuration.
3. Run the project with`npm run start`.

### Docker
 * [`Docker run`](#run)
 * [`Docker Compose/Docker-compose`](#compose)

#### Notable Path/`Binds`/`Volumes`
  * Path required to access the docker API: `/var/run/docker.sock:/var/run/docker.sock` 
  * Path required to store the data (database.db): `your/path/data:/app/data/` 
  * Path required if you want to use yaml config: `your/path/config.yaml:/app/config.yaml`  

## Configuration

The configuration file `config.yaml` (`\app\config.yaml` in docker the container) contains the following sections:

### Main Configuration

The main configuration is specified in the `main` section of `config.yaml`:

|                     Name |     Enviromental Variable     | Type     | Default | Description                                                                                                                                                                                                                           |
| -----------------------: | :---------------------------: | :------- | :-----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `containerCheckInterval` | `MAIN_CONTAINERCHECKINTERVAL` | `string` | `"5m"`  | The interval at which container are checked and published/republished to the MQTT broker, must be in the format`[number][unit]`, where `[number]` is a positive integer and [`[unit]`](#unit).                                        |
|    `updateCheckInterval` |  `MAIN_UPDATECHECKINTERVAL`   | `string` |  `""`   | The interval at which updates are checked and published/republished to the MQTT broker, must be in the format`[number][unit]`, where `[number]` is a positive integer and [`[unit]`](#unit) <br> (same of containerCheckInterval if `""`). |
|                 `prefix` |         `MAIN_PREFIX`         | `string` |  `""`   | Parameter specifies a prefix to add to the MQTT topic when publishing updates. Enabling you to have multiple instances of MqDockerUp publishing to the same MQTT broker without conflicts.                                            |

> [!WARNING] 
> If you upgrade from version 1.14.0 (or lower), some name are changed:
> * `main.interval`/`MAIN_INTERVAL` is now `main.containerCheckInterval`/`MAIN_CONTAINERCHECKINTERVAL`. 
> * `main.imageUpdateInterval`/`MAIN_IMAGEUPDATEINTERVAL`  is now `main.updateCheckInterval`/`MAIN_UPDATECHECKINTERVAL`. 



### <a name="Unit"></a>`[Unit]`

|    __Unit__ |   `s`   |   `m`   |  `h`  | `d`  |  `w`  |
| ----------: | :-----: | :-----: | :---: | :--: | :---: |
| __Meaning__ | Seconds | Minutes | Hours | Days | Weeks |



### MQTT Configuration

The MQTT configuration is specified in the `mqtt` section of `config.yaml`:

|              Name | Enviromental Variable  |   Type    |         Default         | Description                                                                                             |
| ----------------: | :--------------------: | :-------: | :---------------------: | :------------------------------------------------------------------------------------------------------ |
|   `connectionUri` |  `MQTT_CONNECTIONURI`  | `string`  | `mqtt://127.0.0.1:1883` | The URL of the MQTT broker to connect to.                                                               |
|           `topic` |      `MQTT_TOPIC`      | `string`  |      `mqdockerup`       | The MQTT topic to publish updates to.                                                                   |
| `discoveryPrefix` | `MQTT_DISCOVERYPREFIX` | `string`  |     `homeassistant`     | The Prefix chosen in HA as `discovery prefix` (change only if you changed it in HA)                     |
|        `clientId` |    `MQTT_CLIENTID`     | `string`  |      `mqdockerup`       | The MQTT client ID to use when connecting to the broker.                                                |
|        `username` |    `MQTT_USERNAME`     | `string`  |          `ha`           | The username to use when connecting to the MQTT broker.                                                 |
|        `password` |    `MQTT_PASSWORD`     | `string`  |          `""`           | The password to use when connecting to the MQTT broker.                                                 |
|        `haLegacy` |    `MQTT_HALEGACY`     | `boolean` |         `false`         | The way MqDockerUp creates the update entity, `false` for HA 2024.11+ and `true` for previous versions. |
|  `connectTimeout` | `MQTT_CONNECTTIMEOUT`  |   `int`   |          `60`           | The maximum time, in seconds, to wait for a successful connection to the MQTT broker.                   |
| `protocolVersion` | `MQTT_PROTOCOLVERSION` |   `int`   |           `5`           | The MQTT protocol version to use when connecting to the broker.                                         |
| `maxReconnectDelay` | `MQTT_MAXRECONNECTDELAY` | `int` |          `300`          | The maximum time, in seconds, between reconnection attempts when disconnected from the MQTT broker.     |




### Access Tokens Configuration

The access tokens configuration is specified in the `accessTokens` section of `config.yaml`:

|        Name |  Enviromental Variable   |   Type   | Default | Description                                                                                            |
| ----------: | :----------------------: | :------: | :-----: | :----------------------------------------------------------------------------------------------------- |
| `dockerhub` | `ACCESSTOKENS_DOCKERHUB` | `string` |  `""`   | The Dockerhub token, used to avoid the limitations of the DockerHub API _‼️Still Work In Progress_. |
|    `github` |  `ACCESSTOKENS_GITHUB`   | `string` |  `""`   | The Github token, used to manage images on GitHub (`ghcr.io`) _⚠️Needed for this type of images_.   |

> [!NOTE]
>**To setup GitHub access token:**
>
>Setup a [Fine-grained personal access token](https://github.com/settings/personal-access-tokens) with the following permissions:
> - Repository Access -> All repositories
> - Repository Permissions (Read-Only):
>   - Commit Statuses
>   - Contents
>   - Merge queues
>   - Metadata
>   - Pull requests

### Ignore Configuration

The ignore configuration is specified in the `ignore` section of `config.yaml`:

|         Name | Enviromental Variable |   Type   | Default | Description                                                                                                         |
| -----------: | :-------------------: | :------: | :-----: | :------------------------------------------------------------------------------------------------------------------ |
| `containers` |  `IGNORE_CONTAINERS`  | `string` |  `""`   | A comma separated list of container to be ignored in the check, or `*` to ignore all containers .                   |
|    `updates` |   `IGNORE_UPDATES`    | `string` |  `""`   | A comma separated list of container which updates should be ignored in the check, or `*` to ignore all containers . |

### Logs Configuration

The ignore configuration is specified in the `logs` section of `config.yaml`:

|    Name | Enviromental Variable |   Type   | Default  | Description                                                                                                     |
| ------: | :-------------------: | :------: | :------: | :-------------------------------------------------------------------------------------------------------------- |
| `level` |     `LOGS_LEVEL`      | `string` | `"info"` | Choose the maximum level of logs to show, in order `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly` |



## Config Examples

### <a name="yaml"></a> `config.yaml`
Here some examples with all config defaults:
```yaml
main:
  containerCheckInterval: "5m"
  updateCheckInterval: ""
  prefix: ""
mqtt:
  connectionUri: "mqtt://127.0.0.1:1883"
  topic: "mqdockerup"
  discoveryPrefix: "homeassistant"
  clientId: "mqdockerup"
  username: "ha"
  password: "12345678"
  haLegacy: false
  connectTimeout: 60
  protocolVersion: 5
accessTokens:
  dockerhub: "" 
  github: ""
ignore:
  containers: "some,container"
  updates: "other,container"
logs:
  level: "info"
```
You can also use environment variables to override the values in the config file. The environment variables must have the same name as the config keys, but in uppercase and with underscores instead of dots.
For example, to override the `mqtt.connectionUri` value, you can set the `MQTT_CONNECTIONURI` environment variable. 
Here some examples with all variables defaults:

### <a name="run"></a>Docker run

```bash
docker run -d \
  --restart always \
  --name mqdockerup \
  -e MAIN_CONTAINERCHECKINTERVAL="5m" \
  -e MAIN_UPDATECHECKINTERVAL="" \
  -e MAIN_PREFIX="" \
  -e MQTT_CONNECTIONURI="mqtt=//127.0.0.1=1883" \
  -e MQTT_TOPIC="mqdockerup" \
  -e MQTT_DISCOVERYPREFIX="homeassistant" \
  -e MQTT_CLIENTID="mqdockerup" \
  -e MQTT_USERNAME="ha" \
  -e MQTT_PASSWORD="" \
  -e MQTT_HALEGACY=false \
  -e MQTT_CONNECTTIMEOUT=60 \
  -e MQTT_PROTOCOLVERSION=5 \
  -e ACCESSTOKENS_DOCKERHUB="" \
  -e ACCESSTOKENS_GITHUB="" \
  -e IGNORE_CONTAINERS="" \
  -e IGNORE_UPDATES="" \
  -e LOGS_LEVEL="info" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v your/path/data:/app/data/ \
  -v your/path/config.yaml:/app/config.yaml \
  micrib/mqdockerup:latest
```

### <a name="compose"></a>Docker Compose

```yaml
services:
  mqdockerup:
    image: micrib/mqdockerup:latest
    container_name: mqdockerup
    hostname: mqdockerup
    restart: always
    environment:
      MAIN_CONTAINERCHECKINTERVAL: "5m"
      MAIN_UPDATECHECKINTERVAL: ""
      MAIN_PREFIX: ""
      MQTT_CONNECTIONURI: "mqtt://127.0.0.1:1883"
      MQTT_TOPIC: "mqdockerup"
      MQTT_DISCOVERYPREFIX: "homeassistant"
      MQTT_CLIENTID: "mqdockerup"
      MQTT_USERNAME: "ha"
      MQTT_PASSWORD: ""
      MQTT_HALEGACY : false
      MQTT_CONNECTTIMEOUT: 60
      MQTT_PROTOCOLVERSION: 5
      ACCESSTOKENS_DOCKERHUB: ""
      ACCESSTOKENS_GITHUB: ""
      IGNORE_CONTAINERS: ""
      IGNORE_UPDATES: ""
      LOGS_LEVEL: "info"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - your/path/data:/app/data/ 
      - your/path/config.yaml:/app/config.yaml 
```

## Labels

You can use some of these labels on individual containers to apply to them the effect written in the description.


|                           Name |   Type    | Default  | Description                                                                               |
| -----------------------------: | :-------: | :------: | :---------------------------------------------------------------------------------------- |
|  `mqdockerup.ignore_container` | `boolean` | Optional | `true` to ignore the container that have this label, `false` to not ignore                |
|    `mqdockerup.ignore_updates` | `boolean` | Optional | `true` to ignore the updates of the container that have this label, `false` to not ignore |


## Screenshots

![image](https://github.com/user-attachments/assets/f6f78bdb-4f7d-4080-8588-63fdaafa1e51)
<img width="600" alt="image" src="https://user-images.githubusercontent.com/7061122/221386530-d5168c26-8ead-4418-9ab4-84ad6ff91ba9.png">

## Contribute

This project is open source and contributions are welcome. If you have any ideas or suggestions, please open an issue or a pull request.
