/**
* @NApiVersion 2.1
*/
define(['N/log'],
    (log) => {
        /**
         * foreachSublist - helper function to return specifics fields under a sublist of a record
         * @param {Record} rec - the record to get sublist values
         * @param {string} sublistId - the name of target sublist
         * @param {Array} fieldIds - the array of all field name, return obj prop based on this
         * @returns {Array} objs - return the list of obj, one obj as per line level record
         */
        function foreachSublist(rec, sublistId, fieldIds) {
            try {
                let objs = [];
                let lineCount = rec.getLineCount({ sublistId: sublistId });
                for (let i = 0; i < lineCount; i++) {
                    let obj = {};
                    for (let j = 0; j < fieldIds.length; j++) {
                        obj[fieldIds[j]] = rec.getSublistValue({
                            sublistId: sublistId,
                            fieldId: fieldIds[j],
                            line: i
                        });
                    }
                    objs.push(obj);
                }
                return objs;
            } catch (error) {
                log.error(JSON.stringify(error));
            }
        }
        return { foreachSublist }
    });