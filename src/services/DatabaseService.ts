import logger from "../services/LoggerService";
import Database from "better-sqlite3";

export default class DatabaseService {
    static db: Database.Database = new Database('./data/database.db');

    /**
     * Initializes the database.
     * Creates the tables if they don't exist.
     */
    static init() {
        try {
            logger.info('Connected to the database.');
            this.db.exec('CREATE TABLE IF NOT EXISTS containers(id TEXT PRIMARY KEY, name TEXT, image TEXT, tag TEXT)');
            this.db.exec('CREATE TABLE IF NOT EXISTS topics(id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, containerId TEXT)');
            logger.info('Database initialized successfully');
        } catch (err: any) {
            logger.error(err.message);
        }
    }

    /**
     * Adds a container to the database.
     * @param id The container id
     * @param name The container name
     * @param image The container image
     * @param tag The container tag
     */
    public static async addContainer(id: string, name: string, image: string, tag: string) {
        this.db
            .prepare("INSERT OR REPLACE INTO containers(id, name, image, tag) VALUES(?, ?, ?, ?)")
            .run(id, name, image, tag);
    }

    /**
     * Adds a topic to the database.
     * @param topic The subscription topic
     * @param containerId The corresponding container id
     */
    public static async addTopic(topic: string, containerId: string) {
        this.db
            .prepare("INSERT INTO topics(topic, containerId) VALUES(?, ?)")
            .run(topic, containerId);
    }

    /**
     * Gets all containers from the database.
     * @param callback The callback function to call with the results
     */
    public static async getContainers(callback: Function) {
        try {
            const rows = this.db.prepare('SELECT * FROM containers').all();
            callback(null, rows);
        } catch (err) {
            callback(err, null);
        }
    }

    /**
     * Gets a container from the database.
     * @param id The container id
     * @param callback The callback function to call with the results
     */
    public static async getContainer(id: string, callback: Function) {
        try {
            const row = this.db.prepare('SELECT * FROM containers WHERE id = ?').get(id);
            callback(null, row);
        } catch (err) {
            callback(err, null);
        }
    }

    /**
     * Gets all topics for a container from the database.
     * @param containerId The container id
     * @param callback The callback function to call with the results
     */
    public static async getTopics(containerId: string, callback: Function) {
        try {
            const rows = this.db.prepare('SELECT * FROM topics WHERE containerId = ?').all(containerId);
            callback(null, rows);
        } catch (err) {
            callback(err, null);
        }
    }

    /**
     * Checks if an container exists in the database.
     * @param id The container id
     * @return Promise<boolean>
     */
    public static containerExists(id: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            try {
                const container = this.db.prepare('SELECT * FROM containers WHERE id = ?').get(id);
                resolve(!!container);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Deletes a container from the database.
     * @param id The container id
     */
    public static async deleteContainer(id: string) {
        this.db.prepare('DELETE FROM containers WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM topics WHERE containerId = ?').run(id);
    }

    /**
     * Closes the database connection.
     */
    public static async close() {
        try {
            this.db.close();
            logger.info('Closed the database connection.');
        } catch (err: any) {
            logger.error(err.message);
        }
    }
}

// Call the init method to ensure the table is created when the class is loaded
DatabaseService.init();
