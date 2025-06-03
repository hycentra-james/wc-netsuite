/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/record', 'N/log', 'N/task', 'N/file', './ftpHelper'], function (search, record, log, task, file, helper) {

    function getFTPCustomers() {
        var ftpCustomerSearch = search.create({
                                                type: 'customer',
                                                filters: [['custentity_hyc_cust_ftp_isftpcust', 'is', 'T']],
                                                columns: ['internalid']
                                            });
        
        var recordCount = ftpCustomerSearch.runPaged().count;
        
        log.debug('DEBUG', 'recordCount = ' + recordCount);
        // Define search criteria to filter customers based on custentity_hyc_cust_ftp_isftpcust
        return ftpCustomerSearch;
    }

    function map(context) {
        // Retrieve the customer record ID from the context
        var customer = JSON.parse(context.value);

        log.debug('DEBUG', 'customer = ' + customer);
        // Load the customer record
        var customerRecord = record.load({
            type: record.Type.CUSTOMER,
            id: customer.id
        });

        var filenameUnique = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_filename_unique' });
        var invFilename = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_inv_filename' });
        var uploadPath = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_upload_path' });
        var downloadPath = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_ftp_download_path' });
        var invSavedSearchId = customerRecord.getValue({ fieldId: 'custentity_hyc_cust_inv_feed_id' });

        try{
            // Specify the folder path where you want to place the file
            var fileTs = new Date().toISOString().replace(/[^0-9]/g, '');
            var tmpFileName = filenameUnique ? invFilename + fileTs + '.csv' : invFilename + '.csv';

            // Create an empty file in the specified folder
            var tmpFileId = file.create({
                name: tmpFileName,
                fileType: file.Type.PLAINTEXT,
                contents: '',
                folder: 222066 // Hardcoded to /Customers/
            }).save();

            log.debug('DEBUG', tmpFileName + ' created with ID: ' + tmpFileId);
            
            // Export the Saved Search
            log.debug('DEBUG', 'Creating the CSV');
            var searchTask = task.create({
                taskType: task.TaskType.SEARCH
            });
            searchTask.savedSearchId = invSavedSearchId;
            searchTask.fileId = tmpFileId;
            var searchTaskId = searchTask.submit();

            log.debug('DEBUG', 'searchTaskId = ' + searchTaskId);

            while (true) {
                var taskStatus = task.checkStatus({
                    taskId: searchTaskId
                });

                if (taskStatus.status === 'COMPLETE') {
                    log.debug('DEBUG', 'The CSV create task has been completed.');
                    break;
                }
            }

            // Get the tmp CSV file to upload
            var fileToUpload = file.load({id: tmpFileId});  
            
            // Get the FTP Connection
            var connection = helper.getFTPConnection(customerRecord);
                
            // Upload the file to the SFTP server
            connection.upload({
                directory: uploadPath,
                file: fileToUpload,
                replaceExisting: true
            });

            // Finally, delete the temp CSVfile
            file.delete({id: tmpFileId});
            log.debug('DEBUG', 'Removed the temporary files');
        } catch (e) {
            log.error('Error', e);
        }

        // Emit the key-value pair for further processing
        context.write({
            key: customer.id,
            value: {
                invSavedSearchId: invSavedSearchId
            }
        });
    }

    function summarize(context) {
        var totalItemsProcessed = 0;
            context.output.iterator().each(function (key, value) {
                totalItemsProcessed++;
                return true;
            });

        log.debug('Script Complete', 'Records Processed: ' + totalItemsProcessed);
        log.debug('Usage', 'Usage units: ' + context.usage);
        log.debug('Concurrency', 'Concurrency units: ' + context.concurrency);
    }

    return {
        getInputData: getFTPCustomers,
        map: map,
        summarize: summarize
    };

});
