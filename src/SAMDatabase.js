/**
 * SAM-Database.js
 * Contains the SAMDatabase class for managing a client-side database
 * with full-text search capabilities for memos and lore using MiniSearch.
 */
import MiniSearch from 'minisearch';

export class SAMDatabase {
    /**
     * @param {object} config - The configuration object.
     * @param {boolean} [config.enabled=true] - Whether the database functionality is enabled.
     */
    constructor({ enabled = true } = {}) {
        this.isEnabled = enabled;
        this.miniSearch = null;
        this.documentMap = new Map(); // Helper map to store full content
        this.isInitialized = false;

        // Store the config for re-hydration during import
        this.miniSearchConfig = {
            fields: ['key', 'keywords'],
            storeFields: ['key'],
            idField: 'key'
        };
    }

    /**
     * Initializes the search engine.
     * @returns {Promise<boolean>} True if initialization was successful, false otherwise.
     */
    async init() {
        if (!this.isEnabled || this.isInitialized) {
            return this.isInitialized;
        }

        try {
            console.log("SAMDatabase: Initializing with MiniSearch...");
            this.miniSearch = new MiniSearch(this.miniSearchConfig);

            this.isInitialized = true;
            console.log("SAMDatabase: Initialization successful.");
            return true;
        } catch (error) {
            console.error("SAMDatabase: Failed to initialize.", error);
            this.isEnabled = false;
            return false;
        }
    }

    _checkReady() {
        if (!this.isEnabled || !this.isInitialized) {
            console.warn("SAMDatabase is not enabled or initialized.");
            return false;
        }
        return true;
    }

    /**
     * Sets (adds or updates) a memo entry in the database.
     * @param {string} key - The unique primary key for the memo.
     * @param {string} content - The actual content of the memo.
     * @param {string[]} [keywords=[]] - An array of keywords associated with this memo.
     */
    setMemo(key, content, keywords = []) {
        if (!this._checkReady()) return;
        try {
            const document = {
                key: key,
                keywords: [key, ...keywords].join(' ').toLowerCase()
            };

            if (this.miniSearch.has(key)) {
                this.miniSearch.remove({ key });
            }
            this.miniSearch.add(document);

            this.documentMap.set(key, content);

        } catch (error) {
            console.error(`SAMDatabase: Failed to set memo for key "${key}".`, error);
        }
    }

    /**
     * Searches the memos database using a query string.
     * @param {string} query - The search term.
     * @returns {Array<{key: string, content: string}>} An array of matching memo objects, sorted by relevance.
     */
    searchMemos(query) {
        if (!this._checkReady()) return [];
        try {
            const searchResults = this.miniSearch.search(query.toLowerCase());

            return searchResults.map(result => ({
                key: result.key,
                content: this.documentMap.get(result.key)
            }));
        } catch (error) {
            console.error(`SAMDatabase: Search failed for query "${query}".`, error);
            return [];
        }
    }

    /**
     * Deletes a memo by its key.
     * @param {string} key - The key of the memo to delete.
     */
    deleteMemo(key) {
        if (!this._checkReady()) return;
        try {
            if (this.miniSearch.has(key)) {
                this.miniSearch.remove({ key });
                this.documentMap.delete(key);
            }
        } catch (error) {
            console.error(`SAMDatabase: Failed to delete memo for key "${key}".`, error);
        }
    }

    /**
     * Returns all the memos stored in the SAMDatabase.
     * @returns {Object<string, string>} An object where keys are memo keys and values are their content.
     */
    getAllMemosAsObject() {
        if (!this._checkReady()) return {};
        try {
            return Object.fromEntries(this.documentMap.entries());
        } catch (error) {
            console.error("SAMDatabase: Failed to get all memos.", error);
            return {};
        }
    }

    /**
     * Exports the entire database to a JSON string.
     * @returns {string|null} A JSON string representing the database, or null on failure.
     */
    export() {
        if (!this._checkReady()) return null;
        try {
            const dataToExport = {
                miniSearchIndex: this.miniSearch.toJSON(),
                documentMap: Object.fromEntries(this.documentMap.entries())
            };
            return JSON.stringify(dataToExport);
        } catch (error) {
            console.error("SAMDatabase: Failed to export database.", error);
            return null;
        }
    }

    /**
     * Imports a database from a JSON string, overwriting current data.
     * @param {string} jsonString - The JSON string from the export() function.
     * @returns {boolean} True if the import was successful, false otherwise.
     */
    import(jsonString) {
        if (!this.isEnabled) {
            console.warn("SAMDatabase is not enabled.");
            return false;
        }

        try {
            const dataToImport = JSON.parse(jsonString);

            if (!dataToImport.miniSearchIndex || !dataToImport.documentMap) {
                throw new Error("Invalid import data format.");
            }

            // Re-initialize MiniSearch from the imported index data
            this.miniSearch = MiniSearch.loadJSON(JSON.stringify(dataToImport.miniSearchIndex), this.miniSearchConfig);

            // Re-populate the document map
            this.documentMap = new Map(Object.entries(dataToImport.documentMap));

            this.isInitialized = true;
            console.log("SAMDatabase: Import successful.");
            return true;

        } catch (error) {
            console.error("SAMDatabase: Failed to import database.", error);
            // In case of failure, it's safer to reset to a clean state
            this.miniSearch = new MiniSearch(this.miniSearchConfig);
            this.documentMap = new Map();
            return false;
        }
    }
}