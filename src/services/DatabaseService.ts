import logger from "../services/LoggerService";
const sqlite3 = require('sqlite3').verbose();

export default class DatabaseService {
    static db = new sqlite3.Database('./database.db', (err: any) => {
        if (err) {
            logger.error(err.message);
        }
        logger.info('Connected to the database.');
    });

    /**
     * Initializes the database.
     * Creates the tables if they don't exist.
     */
    static init() {
        this.db.run('CREATE TABLE IF NOT EXISTS containers(id TEXT PRIMARY KEY, name TEXT, image TEXT, tag TEXT)');
        this.db.run('CREATE TABLE IF NOT EXISTS topics(id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, containerId TEXT)');
    }

    /**
     * Adds a container to the database.
     * @param id The container id
     * @param name The container name
     * @param image The container image
     * @param tag The container tag
     */
    public static async addContainer(id: string, name: string, image: string, tag: string) {
        const stmt = this.db.prepare("INSERT OR REPLACE INTO containers(id, name, image, tag) VALUES(?, ?, ?, ?)",);
        stmt.run(id, name, image, tag);
        stmt.finalize();
    }

    /**
     * Adds a topic to the database.
     * @param topic The subscription topic
     * @param containerId The corresponding container id
     */
    public static async addTopic(topic: string, containerId: string) {
        const stmt = this.db.prepare("INSERT INTO topics(topic, containerId) VALUES(?, ?)");
        stmt.run(topic, containerId);
        stmt.finalize();
    }

    /**
     * Gets all containers from the database.
     */
    public static async getContainers() {
        return this.db.all('SELECT id FROM containers', []);
    }

    /**
     * Gets a container from the database.
     * @param id The container id
     */
    public static async getContainer(id: string, callback: Function) {
        return this.db.get('SELECT * FROM containers WHERE id = ?');
    }

    /**
     * Gets all topics for a container from the database.
     * @param containerId The container id
     */
    public static async getTopics(containerId: string, callback: Function) {
        return this.db.all('SELECT * FROM topics WHERE containerId = ?', [containerId]);
    }

    /**
     * Deletes a container from the database.
     * @param id The container id
     */
    public static async deleteContainer(id: string) {
        this.db.run('DELETE FROM containers WHERE id = ?', [id]);
        this.db.run('DELETE FROM topics WHERE containerId = ?', [id]);
    }

    /**
     * Opens the database connection.
     */
    public static async open() {
        this.db = new sqlite3.Database('./database.db', (err: any) => {
            if (err) {
                logger.error(err.message);
            }
            logger.info('Connected to the database.');
        });
    }

    /**
     * Closes the database connection.
     */
    public static async close() {
        this.db.close((err: any) => {
            if (err) {
                logger.error(err.message);
            }
            console.log('Closed the database connection.');
        });
    }
}

// Call the init method to ensure the table is created when the class is loaded
DatabaseService.init();