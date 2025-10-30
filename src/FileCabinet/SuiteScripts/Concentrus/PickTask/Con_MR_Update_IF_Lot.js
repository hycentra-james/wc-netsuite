/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/task'], (record, search, runtime, task) => {
    /**
     * Defines the function that is executed at the beginning of the map/reduce process and generates the input data.
     * @param {Object} inputContext
     * @param {boolean} inputContext.isRestarted - Indicates whether the current invocation of this function is the first
     *     invocation (if true, the current invocation is not the first invocation and this function has been restarted)
     * @param {Object} inputContext.ObjectRef - Object that references the input data
     * @typedef {Object} ObjectRef
     * @property {string|number} ObjectRef.id - Internal ID of the record instance that contains the input data
     * @property {string} ObjectRef.type - Type of the record instance that contains the input data
     * @returns {Array|Object|Search|ObjectRef|File|Query} The input data to use in the map/reduce process
     * @since 2015.2
     */

    const getInputData = () => {
        const waveId = runtime.getCurrentScript().getParameter({ name: 'custscript_wave_id' });
        log.debug({ title: 'waveId', details: waveId });

        return search.create({
            type: 'picktask', // 依實際 record type 修改
            filters: [
                ['wavename', 'anyof', waveId],
                // 'AND',
                // ["custrecord_con_apply_sn_to_if", "is", "F"]
            ],
            columns: ['internalid']
        });
    };

    /**
     * Defines the function that is executed when the map entry point is triggered. This entry point is triggered automatically
     * when the associated getInputData stage is complete. This function is applied to each key-value pair in the provided
     * context.
     * @param {Object} mapContext - Data collection containing the key-value pairs to process in the map stage. This parameter
     *     is provided automatically based on the results of the getInputData stage.
     * @param {Iterator} mapContext.errors - Serialized errors that were thrown during previous attempts to execute the map
     *     function on the current key-value pair
     * @param {number} mapContext.executionNo - Number of times the map function has been executed on the current key-value
     *     pair
     * @param {boolean} mapContext.isRestarted - Indicates whether the current invocation of this function is the first
     *     invocation (if true, the current invocation is not the first invocation and this function has been restarted)
     * @param {string} mapContext.key - Key to be processed during the map stage
     * @param {string} mapContext.value - Value to be processed during the map stage
     * @since 2015.2
     */

    const map = (mapContext) => {
        try {
            log.debug({ title: 'mapContext', details: mapContext });
            const result = JSON.parse(mapContext.value);
            const pickTaskId = result.id || (result.values && result.values.internalid && result.values.internalid.value);
            const pickTask = record.load({
                type: 'picktask',
                id: pickTaskId
            });

            const sn = pickTask.getValue('custrecord_sn');
            const lineCount = pickTask.getLineCount({ sublistId: 'pickactions' });

            const writeResult = [];
            for (let i = 0; i < lineCount; i++) {
                const lineNumber = pickTask.getSublistValue({
                    sublistId: 'pickactions',
                    fieldId: 'linenumber',
                    line: i
                });

                const transactionNumber = pickTask.getSublistValue({
                    sublistId: 'pickactions',
                    fieldId: 'transactionnumber',
                    line: i
                });

                if (transactionNumber) {
                    writeResult.push({
                        transactionNumber: transactionNumber,
                        custrecord_sn: sn,
                        linenumber: lineNumber,
                        pickTaskId: pickTaskId
                    });
                }
            }
            writeResult.forEach((v) => {
                log.debug({ title: 'write', details: v });
                mapContext.write({
                    key: v.transactionNumber,
                    value: v
                });
            })

            log.debug('map', { pickTaskId, sn, lines: lineCount });

        } catch (e) {
            log.error('Map Error', { pickTaskId, error: e });
        }
    };

    /**
     * Defines the function that is executed when the reduce entry point is triggered. This entry point is triggered
     * automatically when the associated map stage is complete. This function is applied to each group in the provided context.
     * @param {Object} reduceContext - Data collection containing the groups to process in the reduce stage. This parameter is
     *     provided automatically based on the results of the map stage.
     * @param {Iterator} reduceContext.errors - Serialized errors that were thrown during previous attempts to execute the
     *     reduce function on the current group
     * @param {number} reduceContext.executionNo - Number of times the reduce function has been executed on the current group
     * @param {boolean} reduceContext.isRestarted - Indicates whether the current invocation of this function is the first
     *     invocation (if true, the current invocation is not the first invocation and this function has been restarted)
     * @param {string} reduceContext.key - Key to be processed during the reduce stage
     * @param {List<String>} reduceContext.values - All values associated with a unique key that was passed to the reduce stage
     *     for processing
     * @since 2015.2
     */
    const reduce = (reduceContext) => {
        log.debug({ title: 'reduceContext', details: reduceContext });
        const ifId = reduceContext.key;
        const values = reduceContext.values;

        try {
            const ifRecord = record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: ifId,
                isDynamic: false
            });

            values.forEach((v) => {
                const parsed = JSON.parse(v);
                log.debug({ title: 'parsed', details: parsed });

                const sn = parsed.custrecord_sn;
                const linenumber = parsed.linenumber;

                const lineIndex = ifRecord.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'orderline',
                    value: linenumber
                });

                if (lineIndex !== -1) {
                    const kitMemberOf = ifRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'kitmemberof',
                        line: lineIndex
                    });

                    let targetLine = lineIndex;
                    if (kitMemberOf !== -1) {
                        // find parent line
                        const parentLine = ifRecord.findSublistLineWithValue({
                            sublistId: 'item',
                            fieldId: 'line',
                            value: kitMemberOf
                        });
                        if (parentLine !== -1) {
                            targetLine = parentLine;
                        }
                    }

                    const existingValue = ifRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_fmt_lot_numbers',
                        line: targetLine
                    });

                    let newValue;
                    if (existingValue) {
                        const snList = existingValue.split(',').map(s => s.trim());
                        if (!snList.includes(sn)) {
                            snList.push(sn);
                        }
                        newValue = snList.join(',');
                    } else {
                        newValue = sn;
                    }

                    ifRecord.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_fmt_lot_numbers',
                        line: targetLine,
                        value: newValue
                    });

                    log.debug('Updated line', { ifId, linenumber, targetLine, sn, newValue });
                } else {
                    log.debug('Line not found', { linenumber, ifId });
                }
            });

            ifRecord.save();
            log.audit('Updated IF', { ifId, totalProcessed: values.length });

            // Check pick task checkbox
            // [...new Set(values.map(v => JSON.parse(v).pickTaskId))]
            //     .forEach(pickTaskId => {
            //         record.submitFields({
            //             type: 'picktask',
            //             id: pickTaskId,
            //             values: {
            //                 custrecord_con_apply_sn_to_if: true
            //             }
            //         })
            //     });
        } catch (e) {
            log.error('Reduce Error', { ifId, error: e });
            throw e;
        }
    };


    /**
     * Defines the function that is executed when the summarize entry point is triggered. This entry point is triggered
     * automatically when the associated reduce stage is complete. This function is applied to the entire result set.
     * @param {Object} summaryContext - Statistics about the execution of a map/reduce script
     * @param {number} summaryContext.concurrency - Maximum concurrency number when executing parallel tasks for the map/reduce
     *     script
     * @param {Date} summaryContext.dateCreated - The date and time when the map/reduce script began running
     * @param {boolean} summaryContext.isRestarted - Indicates whether the current invocation of this function is the first
     *     invocation (if true, the current invocation is not the first invocation and this function has been restarted)
     * @param {Iterator} summaryContext.output - Serialized keys and values that were saved as output during the reduce stage
     * @param {number} summaryContext.seconds - Total seconds elapsed when running the map/reduce script
     * @param {number} summaryContext.usage - Total number of governance usage units consumed when running the map/reduce
     *     script
     * @param {number} summaryContext.yields - Total number of yields when running the map/reduce script
     * @param {Object} summaryContext.inputSummary - Statistics about the input stage
     * @param {Object} summaryContext.mapSummary - Statistics about the map stage
     * @param {Object} summaryContext.reduceSummary - Statistics about the reduce stage
     * @since 2015.2
     */
    const summarize = (summary) => {
        log.audit('Script completed', {
            usage: summary.usage,
            yields: summary.yields,
            dateCreated: summary.dateCreated,
            seconds: summary.seconds
        });

        summary.output.iterator().each((key, value) => {
            log.audit('Output', { key, value });
            return true;
        });

        if (summary.reduceSummary.errors) {
            summary.reduceSummary.errors.iterator().each((key, err) => {
                log.debug({title: 'JSON err', details: JSON.parse(err)});
                log.debug({title: 'JSON err name', details: JSON.parse(err).name});
                if (JSON.parse(err).name === 'RCRD_HAS_BEEN_CHANGED') {
                    const mrTask = task.create({
                        taskType: task.TaskType.MAP_REDUCE,
                        scriptId: 'customscript_con_mr_update_if_lot', // Replace with actual script ID
                        params: {
                            custscript_wave_id: runtime.getCurrentScript().getParameter({ name: 'custscript_wave_id' })
                        }
                    });

                    const taskId = mrTask.submit();
                    log.audit('Triggered Map/Reduce', { taskId });
                }
                log.error('Reduce Error', { key, err });
                return true;
            });
        }
    };

    return { getInputData, map, reduce, summarize }

});
