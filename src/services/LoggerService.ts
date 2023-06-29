import winston from 'winston';
import figlet from 'figlet';
import fs from 'fs';
import path from 'path';

const packageJson = require("../../../package.json");

const logsDirectory = path.join(__dirname, 'logs');

if (!fs.existsSync(logsDirectory)) {
  fs.mkdirSync(logsDirectory);
}

const logFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'DD.MM.YYYY HH:mm:ss' }),
  winston.format.align(),
  winston.format.printf(info => {
    const { timestamp, level, message, ...args } = info;

    let output = `\x1b[90m${timestamp}\x1b[0m [${level}] ${message}`;

    return output;
  })
);



const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(logsDirectory, 'app.log'),
      maxsize: 1024 * 1024 * 10, // 10 MB
      maxFiles: 15,
      tailable: true,
      zippedArchive: true
    }),
    new winston.transports.File({
      filename: path.join(logsDirectory, 'error.log'),
      level: 'error',
      maxsize: 1024 * 1024 * 10, // 10 MB
      maxFiles: 15,
      tailable: true,
      zippedArchive: true
    })
  ]
});

const versionAscii = figlet.textSync(`MqDockerUp`, {
  font: 'Standard',
  horizontalLayout: 'default',
  verticalLayout: 'default'
});

const clearConsole = () => {
  console.clear();
  console.log(`\n${versionAscii}\nStarting \x1b[36mMqDockerUp\x1b[0m V${packageJson.version} ... \n`);
};

clearConsole();

export default logger;
export { clearConsole };
