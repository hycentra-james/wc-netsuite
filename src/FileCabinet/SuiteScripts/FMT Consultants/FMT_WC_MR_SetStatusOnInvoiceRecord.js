/**
 * @NApiVersion 2.0
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/format','./Common/FMT_UTL_Common'],
    function (record, search, runtime, format,fmtUtil) {
        function getInputData(context) {
            var invoiceSearchObj;
            try {
                var currentScript = runtime.getCurrentScript();
                var invoiceId = currentScript.getParameter({name: "custscript_fmt_invoice"});
                log.debug("invoiceId", invoiceId);
                var filters = [];
                //Invoice Saved Search
                invoiceSearchObj = search.create({
                    type: "invoice",
                    columns:
                        [
                            search.createColumn({name: "type", label: "Type"}),
                            search.createColumn({
                                name: "internalid",
                                sort: search.Sort.ASC,
                                label: "Internal ID"
                            }),
                            search.createColumn({name: "entity", label: "Name"}),
                            search.createColumn({name: "createdfrom", label: "Created From"})
                        ]
                });

                filters = [
                    ["type", "anyof", "CustInvc"],
                    "AND",
                    ["mainline", "is", "T"],
                    "AND",
                    ["custbodylb_exportstatus", "anyof", "@NONE@"], //blank
                    "AND",
                    ["customer.custentity_fmt_cust_partof_edi","is","T"]
                ];

                if (!!invoiceId) {
                    filters.push("AND");
                    filters.push(["internalid", "is", invoiceId]);
                }

                invoiceSearchObj.filterExpression = filters;

            } catch (e) {
                log.debug('ERROR IN getData() FUNCTION', e);
            }
            return invoiceSearchObj;
        }

        function map(context) {
            try {
                var searchResult = JSON.parse(context.value);
                log.debug('search result', searchResult);

                var invID = parseInt(searchResult.id);
                log.debug('invID', invID);

                var soID = parseInt(searchResult.values.createdfrom.value);
                log.debug('soID', soID);
                var dataSet = [];

                dataSet.push({
                    'invoiceId': invID,
                    'salesorderId': soID
                });

                log.debug('dataSet', dataSet);

                itemFulfillmentSearch(dataSet);
            } catch (e) {
                log.debug('ERROR IN map() FUNCTION', e);
            }
        }

        function itemFulfillmentSearch(dataSet) {
            var savedSearch_itemfulfillment = search.create({
                type: "itemfulfillment",
                filters:
                    [
                        ["type", "anyof", "ItemShip"],
                        "AND",
                        ["custbodylb_exportstatus", "anyof", "1"],      // Exported
                        "AND",
                        ["createdfrom", "anyof", dataSet[0].salesorderId],
                        "AND",
                        ["mainline", "is", "T"],
                        "AND",
                        ["customer.custentity_fmt_cust_partof_edi", "is", "T"],
                    ],
                columns:
                    [
                        search.createColumn({name: "type", label: "Type"}),
                        search.createColumn({name: "internalid", label: "Internal ID"}),
                        search.createColumn({name: "createdfrom", label: "Created From"}),
                        search.createColumn({name: "trandate", label: "Date"})
                    ]
            });

            var resultSet_IF = searchAll(savedSearch_itemfulfillment.run());
            log.debug('resultSet_IF', resultSet_IF);

            if (!!resultSet_IF && resultSet_IF.length > 0) {
                var invRecord = record.load({
                    type: record.Type.INVOICE,
                    id: dataSet[0].invoiceId,
                    isDynamic: true
                });
                log.debug('invRecord', invRecord);

                invRecord.setValue({
                    fieldId: 'custbodylb_exportstatus',
                    value: 3,
                });

                invRecord.setValue({
                    fieldId: 'trandate',
                    value: fmtUtil.formatStringToDate(resultSet_IF[0].getValue({name:"trandate"})),
                });

                var invoiceId = invRecord.save();
                log.debug('invoiceId', invoiceId);
            }
        }

        function searchAll(resultset) {
            var allResults = [];
            var startIndex = 0;
            var RANGECOUNT = 1000;

            do {
                var pagedResults = resultset.getRange({
                    start: parseInt(startIndex),
                    end: parseInt(startIndex + RANGECOUNT)
                });

                allResults = allResults.concat(pagedResults);
                //log.debug({title: '199',details: allResults});

                var pagedResultsCount = pagedResults != null ? pagedResults.length : 0;
                startIndex += pagedResultsCount;

                var remainingUsage = runtime.getCurrentScript().getRemainingUsage();
                log.debug({title: '207', details: remainingUsage});

            }

            while (pagedResultsCount == RANGECOUNT);

            var remainingUsage = runtime.getCurrentScript().getRemainingUsage();
            log.debug({title: '213', details: remainingUsage});

            return allResults;
        }

        return {
            getInputData: getInputData,
            map: map
        };
    });