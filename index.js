
const bq = require('@google-cloud/bigquery');
const Service = require('@akshendra/service');
const { validate, joi } = require('@akshendra/validator');
const { is } = require('@akshendra/misc');


/**
 * @class BigQuery
 */
class BigQuery extends Service {
  /**
   * @param {string} name - unique name to this service
   * @param {EventEmitter} emitter
   * @param {Object} config - configuration object of service
   */
  constructor(name, emitter, config) {
    super(name, emitter, config);

    this.config = validate(config, joi.object().keys({
      projectId: joi.string().required(),
      keyFilename: joi.string(),
    }));
    this.client = null;
    this.datasets = {};
    this.tables = {};
  }


  /**
   * Initialize the config for connecting to google apis
   */
  init() {
    this.emitInfo('connecting', 'On google cloud', {
      projectId: this.config.projectId,
    });
    const { projectId, keyFilename } = this.config;
    const client = bq({
      projectId,
      keyFilename,
    });
    return client.getDatasets().then(() => {
      this.client = client;
      this.emitSuccess(`Successfully connected on project ${this.config.projectId}`);
      return this;
    });
  }


  /**
   * Create a dataset, must be done before anything else, if not already exists.
   *
   * @param {string} datasetName - name of the dataset to use
   *
   * @return {Object} the dataset
   */
  createDataSet(datasetName) {
    this.log.info('Creating dataset', {
      datasetName,
    });
    const dataset = this.client.dataset(datasetName);
    return dataset.exists().then(result => {
      return result[0];
    }).then(exists => {
      if (exists === false) {
        return dataset.create().then(() => {
          this.emitSuccess(`Dataset "${datasetName}" created`);
          return true;
        });
      }
      this.emitSuccess(`Dataset "${datasetName}" already exists`);
      return true;
    }).then(() => {
      this.datasets[datasetName] = dataset;
      return dataset;
    });
  }


  /**
   * Get a dataset, throw error if not present
   *
   * @param {string} datasetName - the name of dataset
   *
   * @return {Object} the dataset object
   * @throws {ReferenceError} dataset not found
   */
  getDataset(datasetName) {
    const dataset = this.datasets[datasetName];
    if (is.not.existy(dataset)) {
      throw new ReferenceError(`Dataset "${datasetName}" not found`);
    }
    return dataset;
  }


  /**
   * Create a table, must be done after creating dataset
   *
   * * @param {string} datasetName - dataset name
   * @param {string} tableName - name of the table to use
   * @param  {Object} schema - a comma-separated list of name:type pairs.
   *   Valid types are "string", "integer", "float", "boolean", and "timestamp".
   *
   * @return {boolean}
   */
  createTable(datasetName, tableName, schema = null) {
    this.log.info('Creating table', {
      datasetName,
      tableName,
      schema,
    });
    // check if table exists
    const dataset = this.getDataset(datasetName);
    const table = dataset.table(tableName);
    return table.exists().then(result => {
      return result[0];
    }).then(exists => {
      if (exists === false && is.not.existy(schema)) {
        throw new ReferenceError(`"${datasetName}.${tableName}" does not exists and no schema was given`);
      }
      if (exists === false && is.exist(schema)) {
        const options = { schema };
        return table.create(options).then(() => {
          this.emitSuccess(`Table "${datasetName}.${tableName}" created`);
          return true;
        });
      }
      this.emitSuccess(`Table "${datasetName}.${tableName}" already exists`);
      return true;
    }).then(() => {
      this.tables[`${datasetName}.${tableName}`] = table;
      return table;
    });
  }


  /**
   * Get a table
   *
   * @param {string} datasetName - dataset name
   * @param {string} tableName - table name
   *
   * @return {Object} the table object
   * @throws {RefrenceError} table not found
   */
  getTable(datasetName, tableName) {
    const table = this.tables[`${datasetName}.${tableName}`];
    if (is.not.existy(table)) {
      throw new ReferenceError(`Table "<${tableName}>" not found in "<${datasetName}>"`);
    }
    return table;
  }


  /**
   * Streaming Insert
   *
   * @param {Object} rows - rows to insert into the table
   * @param {string} datasetName - dataset name
   * @param {string} tableName - table name
   *
   * @return {boolean}
   */
  insert(rows, datasetName, tableName) {
    // check if tableName valid
    const table = this.getTable(datasetName, tableName);
    // Insert into table
    return table.insert(rows).catch(ex => {
      if (ex.name === 'PartialFailureError') {
        throw new Error(JSON.stringify(ex, null, 2));
      }
      throw ex;
    });
  }


  /**
   * Run Query scoped to the dataset
   *
   * @param {string} rawQuery - direct query to run
   *                               Warning: check for SQL injection when accepting input.
   * @param {boolean} [useLegacySql=false]
   * @param {number} [maximumBillingTier=3]
   *
   * @return {Array} rows
   */
  query(rawQuery, useLegacySql = false, maximumBillingTier = 3) {
    const options = {
      query: rawQuery,
      useLegacySql,
      maximumBillingTier,
    };
    return this.client.query(options).then(result => {
      const rows = result[0];
      if (result.errors) {
        throw new Error(result.message);
      } else {
        this.log.info(`Query Successful: ${rawQuery}`);
        return rows;
      }
    }).catch((e) => {
      console.log(e); // eslint-disable-line
      throw new Error(e.message);
    });
  }


  /**
   * Create a query stream
   *
   * @param {string} query - string query
   * @param {boolean} [useLegacySql=false]
   * @param {number} [maximumBillingTier=3]
   *
   * @return {ReadStream}
   */
  queryStream(query, useLegacySql = false, maximumBillingTier = 3) {
    const options = {
      query,
      useLegacySql,
      maximumBillingTier,
    };

    return this.client.createQueryStream(options);
  }


  /**
  * Check if update/delete is available on table
  *
  * @param {string} tableName - table to check
  * @param {string} datasetName - optional
  *
  * @return {boolean}
  */
  updateAvailable(tableName, datasetName) {
    const table = this.getTable(datasetName, tableName);
    // check if table object has streamingBuffer section
    return table.getMetadata().then(result => {
      const metadata = result[0];
      if (metadata.streamingBuffer == null) {
        return true;
      }
      return false;
    });
  }
}

module.exports = BigQuery;
