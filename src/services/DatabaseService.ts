import logger from "../services/LoggerService";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const databasePath = path.join(process.cwd(), 'data', 'database.db');
fs.mkdirSync(path.dirname(databasePath), {recursive: true});

export default class DatabaseService {
    static db: Database.Database = new Database(databasePath);

    /**
     * Initializes the database.
     * Creates the tables if they don't exist.
     */
    static init() {
        try {
            logger.info('Connected to the database.');
            this.db.exec('CREATE TABLE IF NOT EXISTS containers(id TEXT PRIMARY KEY, name TEXT, image TEXT, tag TEXT)');
            this.db.exec('CREATE TABLE IF NOT EXISTS topics(id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, containerId TEXT)');
            this.db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)');
            this.db.exec('DELETE FROM topics WHERE id NOT IN (SELECT MIN(id) FROM topics GROUP BY topic, containerId)');
            this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_topics_topic_containerId ON topics(topic, containerId)');
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
            .prepare("INSERT OR IGNORE INTO topics(topic, containerId) VALUES(?, ?)")
            .run(topic, containerId);
    }

    /**
     * Gets all stored topics across every container.
     * @return An array of { topic, containerId } rows.
     */
    public static getAllTopics(): any[] {
        return this.db.prepare('SELECT * FROM topics').all();
    }

    /**
     * Reads a value from the key/value meta table (used for one-off migrations).
     * @param key The meta key
     * @return The stored value, or undefined if not set
     */
    public static getMeta(key: string): string | undefined {
        const row: any = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
        return row?.value;
    }

    /**
     * Writes a value to the key/value meta table.
     * @param key The meta key
     * @param value The value to store
     */
    public static setMeta(key: string, value: string) {
        this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)').run(key, value);
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

    public static getTopicsForContainer(containerId: string): Promise<{ topic: string }[]> {
        return new Promise((resolve, reject) => {
            try {
                const rows = this.db.prepare('SELECT topic FROM topics WHERE containerId = ?').all(containerId) as { topic: string }[];
                resolve(rows);
            } catch (err) {
                reject(err);
            }
        });
    }

    public static async deleteTopic(topic: string, containerId: string) {
        this.db.prepare('DELETE FROM topics WHERE topic = ? AND containerId = ?').run(topic, containerId);
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
