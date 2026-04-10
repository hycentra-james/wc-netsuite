/**
 * claudeCodeAPI_RL.js
 * RESTlet for Claude Code to access NetSuite data via TBA authentication
 * Supports SuiteQL queries, record operations, and saved searches
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/query', 'N/search', 'N/record', 'N/log', 'N/error', 'N/runtime'],
    (query, search, record, log, error, runtime) => {

    /**
     * Maximum rows to return (governance protection)
     */
    const MAX_ROWS = 1000;

    /**
     * GET request handler - for simple queries via URL parameters
     * @param {Object} requestParams - URL parameters
     * @returns {Object} Response data
     */
    const get = (requestParams) => {
        const startTime = Date.now();

        try {
            const action = requestParams.action;

            switch (action) {
                case 'ping':
                    return {
                        success: true,
                        message: 'Claude Code API is running',
                        timestamp: new Date().toISOString(),
                        user: runtime.getCurrentUser().name,
                        role: runtime.getCurrentUser().role
                    };

                case 'getRecord':
                    return handleGetRecord(requestParams);

                case 'getRecordTypes':
                    return getAvailableRecordTypes();

                default:
                    return {
                        success: false,
                        error: 'Invalid action. Supported GET actions: ping, getRecord, getRecordTypes'
                    };
            }
        } catch (e) {
            log.error({ title: 'GET Error', details: e.message });
            return buildErrorResponse(e, startTime);
        }
    };

    /**
     * POST request handler - for complex queries and operations
     * @param {Object} requestBody - JSON request body
     * @returns {Object} Response data
     */
    const post = (requestBody) => {
        const startTime = Date.now();

        try {
            const action = requestBody.action;

            log.debug({ title: 'POST Request', details: JSON.stringify(requestBody) });

            switch (action) {
                case 'suiteql':
                    return handleSuiteQL(requestBody, startTime);

                case 'search':
                    return handleSavedSearch(requestBody, startTime);

                case 'getRecord':
                    return handleGetRecord(requestBody, startTime);

                case 'createRecord':
                    return handleCreateRecord(requestBody, startTime);

                case 'updateRecord':
                    return handleUpdateRecord(requestBody, startTime);

                case 'lookupFields':
                    return handleLookupFields(requestBody, startTime);

                case 'submitFields':
                    return handleSubmitFields(requestBody, startTime);

                default:
                    return {
                        success: false,
                        error: 'Invalid action. Supported POST actions: suiteql, search, getRecord, createRecord, updateRecord, lookupFields, submitFields'
                    };
            }
        } catch (e) {
            log.error({ title: 'POST Error', details: e.message });
            return buildErrorResponse(e, startTime);
        }
    };

    /**
     * Execute a SuiteQL query
     * @param {Object} params - Query parameters
     * @param {number} startTime - Request start time
     * @returns {Object} Query results
     */
    const handleSuiteQL = (params, startTime) => {
        const sql = params.query || params.sql;

        if (!sql) {
            throw error.create({
                name: 'MISSING_PARAMETER',
                message: 'Query parameter "query" or "sql" is required'
            });
        }

        const maxRows = Math.min(params.maxRows || MAX_ROWS, MAX_ROWS);

        log.audit({ title: 'Executing SuiteQL', details: sql });

        const results = [];
        let columns = [];

        // Run the query with paging for large result sets
        const queryResults = query.runSuiteQL({
            query: sql
        });

        // Get column metadata from first result
        const iterator = queryResults.iterator();
        let rowCount = 0;

        iterator.each((result) => {
            if (rowCount === 0) {
                // Extract column names from first row
                columns = Object.keys(result.value.asMap());
            }

            results.push(result.value.asMap());
            rowCount++;

            return rowCount < maxRows; // Continue if under limit
        });

        return {
            success: true,
            action: 'suiteql',
            rowCount: results.length,
            hasMore: rowCount >= maxRows,
            columns: columns,
            results: results,
            executionTime: Date.now() - startTime
        };
    };

    /**
     * Execute a saved search
     * @param {Object} params - Search parameters
     * @param {number} startTime - Request start time
     * @returns {Object} Search results
     */
    const handleSavedSearch = (params, startTime) => {
        let searchObj;

        if (params.searchId) {
            // Load existing saved search
            searchObj = search.load({ id: params.searchId });

            // Apply additional filters if provided
            if (params.filters && params.filters.length > 0) {
                const existingFilters = searchObj.filters || [];
                searchObj.filters = existingFilters.concat(params.filters);
            }
        } else if (params.type) {
            // Create ad-hoc search
            searchObj = search.create({
                type: params.type,
                filters: params.filters || [],
                columns: params.columns || []
            });
        } else {
            throw error.create({
                name: 'MISSING_PARAMETER',
                message: 'Either "searchId" or "type" is required'
            });
        }

        const maxRows = Math.min(params.maxRows || MAX_ROWS, MAX_ROWS);
        const results = [];
        let columns = [];

        const pagedData = searchObj.runPaged({ pageSize: 1000 });

        let rowCount = 0;
        let breakOut = false;

        pagedData.pageRanges.forEach((pageRange) => {
            if (breakOut) return;

            const page = pagedData.fetch({ index: pageRange.index });

            page.data.forEach((result) => {
                if (rowCount >= maxRows) {
                    breakOut = true;
                    return;
                }

                // Get column info from first result
                if (rowCount === 0) {
                    columns = result.columns.map(col => ({
                        name: col.name,
                        label: col.label,
                        type: col.type
                    }));
                }

                // Build result object
                const row = {
                    id: result.id,
                    recordType: result.recordType
                };

                result.columns.forEach((col, index) => {
                    const colName = col.label || col.name;
                    row[colName] = result.getValue(col);
                    row[colName + '_text'] = result.getText(col);
                });

                results.push(row);
                rowCount++;
            });
        });

        return {
            success: true,
            action: 'search',
            searchId: params.searchId || null,
            searchType: searchObj.searchType,
            rowCount: results.length,
            hasMore: rowCount >= maxRows,
            columns: columns,
            results: results,
            executionTime: Date.now() - startTime
        };
    };

    /**
     * Get a single record
     * @param {Object} params - Record parameters
     * @param {number} startTime - Request start time
     * @returns {Object} Record data
     */
    const handleGetRecord = (params, startTime = Date.now()) => {
        const recordType = params.recordType || params.type;
        const recordId = params.recordId || params.id;

        if (!recordType || !recordId) {
            throw error.create({
                name: 'MISSING_PARAMETER',
                message: 'Both "recordType" and "recordId" are required'
            });
        }

        const rec = record.load({
            type: recordType,
            id: recordId,
            isDynamic: false
        });

        // Get all body fields
        const fields = rec.getFields();
        const bodyFields = {};

        fields.forEach((fieldId) => {
            try {
                bodyFields[fieldId] = {
                    value: rec.getValue({ fieldId: fieldId }),
                    text: rec.getText({ fieldId: fieldId })
                };
            } catch (e) {
                // Some fields may not be readable
                bodyFields[fieldId] = { value: null, text: null, error: e.message };
            }
        });

        // Get sublists
        const sublists = {};
        const sublistIds = rec.getSublists();

        sublistIds.forEach((sublistId) => {
            const lineCount = rec.getLineCount({ sublistId: sublistId });
            const lines = [];

            // Limit lines to prevent governance issues
            const maxLines = Math.min(lineCount, 100);

            for (let i = 0; i < maxLines; i++) {
                const sublistFields = rec.getSublistFields({ sublistId: sublistId });
                const lineData = { line: i };

                sublistFields.forEach((fieldId) => {
                    try {
                        lineData[fieldId] = {
                            value: rec.getSublistValue({ sublistId, fieldId, line: i }),
                            text: rec.getSublistText({ sublistId, fieldId, line: i })
                        };
                    } catch (e) {
                        // Skip unreadable fields
                    }
                });

                lines.push(lineData);
            }

            sublists[sublistId] = {
                lineCount: lineCount,
                hasMore: lineCount > maxLines,
                lines: lines
            };
        });

        return {
            success: true,
            action: 'getRecord',
            recordType: recordType,
            recordId: recordId,
            fields: bodyFields,
            sublists: sublists,
            executionTime: Date.now() - startTime
        };
    };

    /**
     * Create a new record
     * @param {Object} params - Record parameters
     * @param {number} startTime - Request start time
     * @returns {Object} Created record ID
     */
    const handleCreateRecord = (params, startTime) => {
        const recordType = params.recordType || params.type;

        if (!recordType) {
            throw error.create({
                name: 'MISSING_PARAMETER',
                message: '"recordType" is required'
            });
        }

        const rec = record.create({
            type: recordType,
            isDynamic: params.isDynamic || false
        });

        // Set body fields
        if (params.values) {
            Object.keys(params.values).forEach((fieldId) => {
                try {
                    rec.setValue({
                        fieldId: fieldId,
                        value: params.values[fieldId]
                    });
                } catch (e) {
                    log.debug({ title: 'Field Set Error', details: `${fieldId}: ${e.message}` });
                }
            });
        }

        // Set sublist lines
        if (params.sublists) {
            Object.keys(params.sublists).forEach((sublistId) => {
                const lines = params.sublists[sublistId];

                lines.forEach((lineData, index) => {
                    Object.keys(lineData).forEach((fieldId) => {
                        try {
                            rec.setSublistValue({
                                sublistId: sublistId,
                                fieldId: fieldId,
                                line: index,
                                value: lineData[fieldId]
                            });
                        } catch (e) {
                            log.debug({ title: 'Sublist Set Error', details: `${sublistId}.${fieldId}: ${e.message}` });
                        }
                    });
                });
            });
        }

        const recordId = rec.save({
            enableSourcing: params.enableSourcing !== false,
            ignoreMandatoryFields: params.ignoreMandatoryFields || false
        });

        return {
            success: true,
            action: 'createRecord',
            recordType: recordType,
            recordId: recordId,
            executionTime: Date.now() - startTime
        };
    };

    /**
     * Update an existing record
     * @param {Object} params - Record parameters
     * @param {number} startTime - Request start time
     * @returns {Object} Updated record ID
     */
    const handleUpdateRecord = (params, startTime) => {
        const recordType = params.recordType || params.type;
        const recordId = params.recordId || params.id;

        if (!recordType || !recordId) {
            throw error.create({
                name: 'MISSING_PARAMETER',
                message: 'Both "recordType" and "recordId" are required'
            });
        }

        const rec = record.load({
            type: recordType,
            id: recordId,
            isDynamic: params.isDynamic || false
        });

        // Update body fields
        if (params.values) {
            Object.keys(params.values).forEach((fieldId) => {
                try {
                    rec.setValue({
                        fieldId: fieldId,
                        value: params.values[fieldId]
                    });
                } catch (e) {
                    log.debug({ title: 'Field Update Error', details: `${fieldId}: ${e.message}` });
                }
            });
        }

        // Update sublist lines: { sublistId: "package", lines: [{ line: 0, values: { fieldId: value } }] }
        if (params.sublists && Array.isArray(params.sublists)) {
            params.sublists.forEach((sublistUpdate) => {
                const sublistId = sublistUpdate.sublistId;
                if (sublistUpdate.lines && Array.isArray(sublistUpdate.lines)) {
                    sublistUpdate.lines.forEach((lineUpdate) => {
                        Object.keys(lineUpdate.values).forEach((fieldId) => {
                            try {
                                rec.setSublistValue({
                                    sublistId: sublistId,
                                    fieldId: fieldId,
                                    line: lineUpdate.line,
                                    value: lineUpdate.values[fieldId]
                                });
                            } catch (e) {
                                log.debug({ title: 'Sublist Update Error', details: `${sublistId}[${lineUpdate.line}].${fieldId}: ${e.message}` });
                            }
                        });
                    });
                }
            });
        }

        const savedId = rec.save({
            enableSourcing: params.enableSourcing !== false,
            ignoreMandatoryFields: params.ignoreMandatoryFields || false
        });

        return {
            success: true,
            action: 'updateRecord',
            recordType: recordType,
            recordId: savedId,
            executionTime: Date.now() - startTime
        };
    };

    /**
     * Lookup fields on a record (lightweight)
     * @param {Object} params - Lookup parameters
     * @param {number} startTime - Request start time
     * @returns {Object} Field values
     */
    const handleLookupFields = (params, startTime) => {
        const recordType = params.recordType || params.type;
        const recordId = params.recordId || params.id;
        const columns = params.columns || params.fields;

        if (!recordType || !recordId || !columns) {
            throw error.create({
                name: 'MISSING_PARAMETER',
                message: '"recordType", "recordId", and "columns" are required'
            });
        }

        const fieldValues = search.lookupFields({
            type: recordType,
            id: recordId,
            columns: columns
        });

        return {
            success: true,
            action: 'lookupFields',
            recordType: recordType,
            recordId: recordId,
            fields: fieldValues,
            executionTime: Date.now() - startTime
        };
    };

    /**
     * Submit fields on a record (lightweight update)
     * @param {Object} params - Submit parameters
     * @param {number} startTime - Request start time
     * @returns {Object} Updated record ID
     */
    const handleSubmitFields = (params, startTime) => {
        const recordType = params.recordType || params.type;
        const recordId = params.recordId || params.id;
        const values = params.values;

        if (!recordType || !recordId || !values) {
            throw error.create({
                name: 'MISSING_PARAMETER',
                message: '"recordType", "recordId", and "values" are required'
            });
        }

        const savedId = record.submitFields({
            type: recordType,
            id: recordId,
            values: values,
            options: {
                enableSourcing: params.enableSourcing !== false,
                ignoreMandatoryFields: params.ignoreMandatoryFields || false
            }
        });

        return {
            success: true,
            action: 'submitFields',
            recordType: recordType,
            recordId: savedId,
            executionTime: Date.now() - startTime
        };
    };

    /**
     * Get list of common record types
     * @returns {Object} Record types list
     */
    const getAvailableRecordTypes = () => {
        return {
            success: true,
            action: 'getRecordTypes',
            recordTypes: [
                { id: 'salesorder', name: 'Sales Order' },
                { id: 'purchaseorder', name: 'Purchase Order' },
                { id: 'invoice', name: 'Invoice' },
                { id: 'itemfulfillment', name: 'Item Fulfillment' },
                { id: 'itemreceipt', name: 'Item Receipt' },
                { id: 'customer', name: 'Customer' },
                { id: 'vendor', name: 'Vendor' },
                { id: 'employee', name: 'Employee' },
                { id: 'inventoryitem', name: 'Inventory Item' },
                { id: 'kititem', name: 'Kit/Package' },
                { id: 'assemblyitem', name: 'Assembly Item' },
                { id: 'noninventoryitem', name: 'Non-Inventory Item' },
                { id: 'serviceitem', name: 'Service Item' },
                { id: 'customerpayment', name: 'Customer Payment' },
                { id: 'vendorbill', name: 'Vendor Bill' },
                { id: 'vendorpayment', name: 'Vendor Payment' },
                { id: 'journalentry', name: 'Journal Entry' },
                { id: 'transferorder', name: 'Transfer Order' },
                { id: 'returnauthorization', name: 'Return Authorization' },
                { id: 'creditmemo', name: 'Credit Memo' },
                { id: 'opportunity', name: 'Opportunity' },
                { id: 'estimate', name: 'Estimate/Quote' },
                { id: 'case', name: 'Case/Support' },
                { id: 'task', name: 'Task' },
                { id: 'phonecall', name: 'Phone Call' },
                { id: 'event', name: 'Event' }
            ]
        };
    };

    /**
     * Build error response
     * @param {Error} e - Error object
     * @param {number} startTime - Request start time
     * @returns {Object} Error response
     */
    const buildErrorResponse = (e, startTime) => {
        return {
            success: false,
            error: {
                name: e.name,
                message: e.message,
                stack: e.stack
            },
            executionTime: Date.now() - startTime
        };
    };

    return {
        get: get,
        post: post
    };
});
