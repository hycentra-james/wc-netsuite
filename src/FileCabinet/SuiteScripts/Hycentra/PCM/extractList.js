/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/record', 'N/log', 'N/search', 'N/file'],
    function(record, log, search, file) {

    function getListIdByName(listName) {
        // Search for the internal ID of the list based on its name
        var listSearch = search.create({
            type: 'customlist', // Adjust based on your field type
            filters: [
                ['name', 'is', listName]
            ],
            columns: ['internalid', 'scriptid']
        });

        var result = listSearch.run().getRange({
            start: 0,
            end: 1
        });

        if (result.length > 0) {
            var listData = {};
            listData['internalid'] = result[0].getValue('internalid');
            listData['scriptid'] = result[0].getValue('scriptid');

            return listData;
        }

        return null;
    }

    function onRequest(context) {
        try {
            // Define the list/record field names you want to export
            var fieldNames = [
              "Countertop Material",
              "CG inventory",
              "Collection",
              "Vanity Color",
              "Countertop Color",
              "Countertop Finish",
              "Countertop Material",
              "Countertop Thickness",
              "Faucet Handle Style",
              "Finish Listing",
              "Item Status",
              "Item Width/Length",
              "Kitchen Sink Grid",
              "Kitchen Sink Strainer",
              "Kitchen Sink Type",
              "Materials",
              "Number of Sinks",
              "Pallet Dimension List",
              "Pick Group",
              "Pull & Knob Finish",
              "Pull & Knob Material",
              "Ship Type",
              "Style Listing",
              "Vanity Mounting Type",
              "Vanity Sink Material",
              "Vanity Sink Shape",
              "Vanity Sink Size",
              "Vanity Sink Type",
            ];
            // Add more field names as needed

            // Initialize an empty string to concatenate CSV content
            var excelContent = 'List Internal ID,List ID,List Name,Option Internal ID,Option Value\n';

            // Iterate over each field name
            for (var i = 0; i < fieldNames.length; i++) {
                var listName = fieldNames[i];

                // Get the internal ID of the list based on its name
                log.debug("DEBUG", "before: getListIdByName(listName)");
                var listData = getListIdByName(listName);
                log.debug("DEBUG", "after: getListIdByName(listName)");
                log.debug("DEBUG", "listName = " + listName);
                log.debug("DEBUG", "listData['scriptid'] = " + listData['scriptid']);
                log.debug("DEBUG", "listData['internalid'] = " + listData['internalid']);

                if (listData) {
                    // Search for the options of the list/record field
                    var optionsSearch = search.create({
                        type: listData['scriptid'], 
                        columns: ['internalId', 'name']
                    });

                    var options = optionsSearch.run().getRange({
                        start: 0,
                        end: 1000 // Adjust based on the number of options
                    });

                    // Append options to the CSV content
                    for (var j = 0; j < options.length; j++) {
                        excelContent += listData['internalid'] + ',' + listData['scriptid'] + ',' + listName + ',' + options[j].getValue('internalid') + ',' + options[j].getValue('name') + '\n';
                    }
                } else {
                    log.error({
                        title: 'List Not Found',
                        details: 'List with name "' + listName + '" not found.'
                    });
                }
            }

            // Create a file with the Excel content
            var fileObj = file.create({
                name: 'ListOptionsExport.csv', // Adjust the file name and extension
                fileType: file.Type.CSV,
                contents: excelContent,
                folder: 78799 // Hardcoded to /Customers/
            });

            // Save the file to the file cabinet
            var fileId = fileObj.save();

            // Log the file URL
            log.debug({
                title: 'List Options Exported',
                details: 'File URL: ' + fileObj.url
            });

            context.response.write('List options exported successfully.');
        } catch (e) {
            log.error({
                title: 'Error Exporting List Options',
                details: e.toString()
            });

            context.response.write('Error exporting list options. Check the script log for details.');
        }
    }

    return {
        onRequest: onRequest
    };
});
