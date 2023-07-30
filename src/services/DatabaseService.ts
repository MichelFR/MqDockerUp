import logger from "../services/LoggerService";
const sqlite3 = require('sqlite3').verbose();

export default class DatabaseService {
    static db = new sqlite3.Database('./data/database.db', (err: any) => {
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
        this.db.serialize(() => {
            this.db.run('CREATE TABLE IF NOT EXISTS containers(id TEXT PRIMARY KEY, name TEXT, image TEXT, tag TEXT)', (err: Error | null) => {
                if (err) {
                    logger.error(err.message);
                    return;
                }

                this.db.run('CREATE TABLE IF NOT EXISTS topics(id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, containerId TEXT)', (err: Error | null) => {
                    if (err) {
                        logger.error(err.message);
                        return;
                    }

                    logger.info('Database initialized successfully');
                });
            });
        });
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
  * @param callback The callback function to call with the results
  */
    public static async getContainers(callback: Function) {
        this.db.all('SELECT * FROM containers', [], (err: any, rows: any) => {
            callback(err, rows);
        });
    }

    /**
     * Gets a container from the database.
     * @param id The container id
     * @param callback The callback function to call with the results
     */
    public static async getContainer(id: string, callback: Function) {
        this.db.get('SELECT * FROM containers WHERE id = ?', [id], (err: any, row: any) => {
            callback(err, row);
        });
    }

    /**
     * Gets all topics for a container from the database.
     * @param containerId The container id
     */
    public static async getTopics(containerId: string, callback: Function) {
        this.db.all('SELECT * FROM topics WHERE containerId = ?', [containerId], (err: any, rows: any) => {
            callback(err, rows);
        });
    }


    /**
 * Checks if an container exists in the database.
 * @param id The container id
 * @return Promise<boolean>
 */
    public static containerExists(id: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM containers WHERE id = ?', [id], (err: any, container: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(!!container);
                }
            });
        });
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