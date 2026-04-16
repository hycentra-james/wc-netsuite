/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */
define(['N/record', 'N/log', 'N/search', 'N/task'], function(record, log, search, task) {

    function execute(context) {
        // Perform a search to find Inventory Item records with class = 1, 3, or 4 only
        var itemSearch = search.create({
            type: search.Type.INVENTORY_ITEM,
            filters: [
                //['class', search.Operator.ANYOF, [1,3,4]] // Belongs to class 1, 3, or 4 (Vanity + TT + LC)
                //['class', search.Operator.ANYOF, [2, 12, 10, 5]] // (Washstands + Backsplash + Bath Access, Counter Tops)
                ['class', search.Operator.ANYOF, [2, 10]] // (Bath Access)
                //['class', search.Operator.ANYOF, [5]] // (Counter Tops)
                //['class', search.Operator.ANYOF, [3,4]] // Belongs to class 1 (Vanity)
                // 8 - Faucet, 6 - Mirror
                //['class', search.Operator.ANYOF, [13, 14, 15, 17, 19, 20, 21, 22, 24, 25, 26, 27, 28]] // All Faucet
                //['class', search.Operator.ANYOF, [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28]] // All Faucet
                //['internalId', search.Operator.ANYOF, [1081,8469,8883,8470,1082,1083,1084,1085,1086,12218,12219,12220,12221,897,1087,898,899,900,1088,901,902,903,1089,904,905,1090,906,907,1091,908,909,910,1092,911,912,913,914,1093,915,916,917,1094,918,919,920,1095,921,922,923,924,925,1096,926,927,929,1097,930,931,932,1098,1099,933,934,1100,1101,935,936,1102,1103,937,938,1104,1105,939,940,9093,9506,9094,9507,9095,9508,749,10342,7328,750,945,946,947,948,949,950,951,952,1106,11592,10967,957,958,7748,10968,1107,11593,11594,959,960,7749,10969,11393,11394,11395,11397,961,12214,12215,12216,12217,962,1149,1150,1151,1152,1153,6922,6923,6924,1108,963,1109,964,1110,965,1111,966,1112,967,1113,968,751,752,13324,10865,11191,13325,10866,11192,13326,10867,11193,994,1114,995,996,997,998,999,1000,1001,1002,1003,1115,1004,1005,1006,10129,10229,10230]]
                // 16, 18 - Handle is Done
                //53,153,249,250,251,252,253,254,255,256,257,258,259,260,261,262,263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,329,330,331,332,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,429,430,431,432,433,434,435,436,437,438,8163,520,521,522,523,7330,7329,558,559,560,561,562,565,566,567,568,569,570,571,572,573,574,575,576,577,578,579,580,581,582,583,590,591,592,
                //593,594,595,596,597,598,599,600,6619,6620,6621
            ],
            columns: ['internalid']
        });

        // Run the search and process each result
        var itemIdArray = [];
       
        itemSearch.run().each(function(result) {
            itemIdArray.push(result.getValue('internalid'));
            return true; // Continue processing results
        });

        // Will trigger the ItemFieldSync_SS directly
        log.debug("DEBUG", "itemIdArray = " + itemIdArray);
        var scriptTask = task.create({
            taskType: task.TaskType.SCHEDULED_SCRIPT,
            scriptId: 'customscript_hyc_item_fields_sync_ss', // Script ID
            deploymentId: 'customdeploy_hyc_item_fields_sync_ss_dpl', // Deployment ID
            params: {
                custscript_item_id: itemIdArray.join(",")
            }
        });

        var taskId = scriptTask.submit();
        log.debug('Scheduled Script Submitted', 'Task ID: ' + taskId);

        // Iterate over the item ID array and load/save each record to trigger UserEvent script
        /*
        itemIdArray.forEach(function(itemId) {
            try {
                // Load the record to simulate a full save
                var itemRecord = record.load({
                    type: record.Type.INVENTORY_ITEM,
                    id: itemId,
                    isDynamic: true
                });

                // Save the record to trigger the UserEvent
                itemRecord.save({
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                });

                log.debug("UserEvent Triggered", "Successfully saved Inventory Item ID: " + itemId);

            } catch (e) {
                log.error("Error Saving Inventory Item", "Item ID: " + itemId + ". Error: " + e.message);
            }
        });
        */
    }

    return {
        execute: execute
    };
});