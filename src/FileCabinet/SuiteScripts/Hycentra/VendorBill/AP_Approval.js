/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/log', 'N/email', 'N/render'],
    function (record, search, log, email, render) {

        function beforeSubmit(context) {
            try {
                if (context.type === context.UserEventType.CREATE || 
                        (context.type === context.UserEventType.EDIT && 
                            isRecordChanged(context.newRecord, context.oldRecord) && 
                            !isApprovalStatusChanged(context.newRecord, context.oldRecord))) {

                    // Get the current vendor bill record
                    var currentRecord = context.newRecord;
                    
                    // Get the form ID
                    // var formId = currentRecord.getValue({fieldId: 'customform'});

                    // Default set approval status to Pending Approval, and if there's any r
                    // 1 = Pending Approval, 2 = Approved
                    currentRecord.setValue({fieldId: 'approvalstatus', value: 1});
                    
                    // Set the form must be using the new form to prevent Bill copying from existing Bill which was using the old form
                    currentRecord.setValue({fieldId: 'customform', value: 183});

                    var manualApproval = currentRecord.getValue({ fieldId: 'custbody_hyc_vb_manual_approval'});
                    var secApprover = currentRecord.getValue({ fieldId: 'custbody_hyc_vb_sec_approver'});

                    // See if manual approval overriding the approval config 
                    if (manualApproval) {
                        currentRecord.setValue({fieldId: 'nextapprover', value: secApprover});
                    } else {
                        // Make sure we are not storing sec approver value if it's not manual approval
                        currentRecord.setValue({fieldId: 'custbody_hyc_vb_sec_approver', value: ''});

                        // Get the vendor ID from the bill record
                        var vendorId = currentRecord.getValue({ fieldId: 'entity' });
    
                        // Search for the Vendor Bill Approval Config record based on the vendor ID
                        var vendorBillConfigSearch = search.create({
                            type: 'customrecord_hyc_vb_approval_config',
                            columns: [
                                'custrecord_hyc_vb_appcfg_approver', 
                                'custrecord_hyc_vb_appcfg_autoapp'
                            ],
                            filters: ['custrecord_hyc_vb_appcfg_vendor', search.Operator.IS, vendorId]
                        });
    
                        var vendorBillConfigResults = vendorBillConfigSearch.run().getRange({ start: 0, end: 1 });
    
                        if (vendorBillConfigResults && vendorBillConfigResults.length > 0) {
                            // A matching Vendor Bill Approval Config record is found
                            var approverId = vendorBillConfigResults[0].getValue('custrecord_hyc_vb_appcfg_approver');
                            var autoApprove = vendorBillConfigResults[0].getValue('custrecord_hyc_vb_appcfg_autoapp');
                            
                            if (autoApprove) {
                                // Set approval status to Approved if the vendor bill is auto approved
                                currentRecord.setValue({fieldId: 'approvalstatus', value: 2});
                            } else {
                                if (approverId) {
                                    currentRecord.setValue({fieldId: 'nextapprover', value: approverId});
                                } else {
                                }
    
                            }
            
                            // Log the values for testing (check the script execution logs)
                        }
                    }

                } 
            } catch (e) {
                log.error('Error', e);
            }
        }

        function afterSubmit(context) {

            var currentRecord = context.newRecord;

            // Send email to approver
            if (context.type === context.UserEventType.CREATE || (context.type === context.UserEventType.EDIT && isRecordChanged(context.newRecord, context.oldRecord))) {
                try {
                    // Get the form ID
                    // var formId = currentRecord.getValue({fieldId: 'customform'});

                    var vendor = currentRecord.getValue({ fieldId: 'entity' });
                    var approverId = currentRecord.getValue({fieldId: 'nextapprover'});
                    var approvalStatus = currentRecord.getValue({fieldId: 'approvalstatus'});

                    // If there's an nextApprover and approval status is Pending Approval
                    if (approverId && approvalStatus == 1) {
                        sendEmailNotificationToApprover(currentRecord);
                    } 
                } catch (e) {
                    log.error('Error', e);
                }
            }

            // Send approved email
            if (context.type === context.UserEventType.EDIT) {
                var approvalStatus = currentRecord.getValue({fieldId: 'approvalstatus'});

                if ((context.type === context.UserEventType.EDIT && isApprovalStatusChanged(context.newRecord, context.oldRecord)) && approvalStatus == 2) {
                    try {
                        sendApprovedEmailNotification(currentRecord);
                    } catch (e) {
                        log.error('Error', e);
                    }
                }
            }

        }

        function sendApprovedEmailNotification(currentRecord) {

            // Get the Vendor of the Vendor Bill
            var vendorRec = record.load({ 
                type: record.Type.VENDOR, 
                id: currentRecord.getValue({ fieldId: 'entity'}) 
            });

            var emailSubject = '[APPROVED] Vendor Bill Approval - (' + vendorRec.getValue({ fieldId: 'companyname' }) + ')';
            var emailBody = '<p>Dear Accounting Team,</p>' +
                                '<p><a href="https://6511399.app.netsuite.com/app/accounting/transactions/vendbill.nl?id=' + currentRecord.id + '" target="_blank">Vendor Bill</a> has been approved</p>' +
                                '<p>' +
                                     'Vendor: <strong>' + vendorRec.getValue({ fieldId: 'companyname' }) + '</strong><br />' +
                                     'Amount: <strong>$' + currentRecord.getValue({ fieldId: 'total' }) + '</strong><br />' +
                                '</p>';

            email.send({
                author: 13183, // Water Creation [Notification] user
                recipients: 'ap@water-creation.com', // TODO: Change the recipient ID to approver
                subject: emailSubject,
                body: emailBody,
                relatedRecords: {
                    transactionId: currentRecord.id
                }
            });
        }

        function sendEmailNotificationToApprover(currentRecord) {
            var approverId = currentRecord.getValue({fieldId: 'nextapprover'});
            
            // Get the approver Employee record
            var approverRec = record.load({type: record.Type.EMPLOYEE, id: approverId});

            var approverEmail = approverRec.getValue({fieldId: 'email'});
            // Get the email address from the employee record

            // Get the Vendor of the Vendor Bill
            var vendorRec = record.load({ 
                                type: record.Type.VENDOR, 
                                id: currentRecord.getValue({ fieldId: 'entity'}) 
                            });

            // For testing purpose - approver Id set to James
            // approverId = 5763;

            // See if we need to use email template
            /*
            var emailTemplate = render.mergeEmail({
                templateId: 110, //custemailtmpl_hyc_emltmpl_vendor_bill_app_notification
                transactionId: currentRecord.id
            })
            */

            var emailSubject = '[ACTION REQUIRED] Vendor Bill Approval - (' + vendorRec.getValue({ fieldId: 'companyname' }) + ')';
            var emailBody = '<p>Dear ' + approverRec.getValue({fieldId: 'firstname'}) + ',</p>' +
                                '<p>A new <a href="https://6511399.app.netsuite.com/app/accounting/transactions/vendbill.nl?id=' + currentRecord.id + '" target="_blank">Vendor Bill</a> has created and pending approval</p>' +
                                '<p>' +
                                     'Vendor: <strong>' + vendorRec.getValue({ fieldId: 'companyname' }) + '</strong><br />' +
                                     'Amount: <strong>$' + currentRecord.getValue({ fieldId: 'total' }) + '</strong><br />' +
                                '</p>' + 
                                '<p>Alternatively, you can go to <a href="https://6511399.app.netsuite.com/app/accounting/transactions/vendorbillmanager.nl?type=apprv&amp;whence=" target="_blank">Approve Bills</a> page to perform bulk approval</p>';

            email.send({
                author: 13183, // Water Creation [Notification] user
                recipients: approverId, // TODO: Change the recipient ID to approver
                subject: emailSubject,
                body: emailBody,
                relatedRecords: {
                    transactionId: currentRecord.id
                }
            });
        }

        function isApprovalStatusChanged(newRecord, oldRecord) {
            return (newRecord.getValue({fieldId: 'approvalstatus'}) != oldRecord.getValue({fieldId: 'approvalstatus'}));
        }

        function isRecordChanged(newRecord, oldRecord) {
            // total
            // tranid
            // trandate
            // approvalstatus
            // duedate
            // custbody_hyc_vb_manual_approval
            // custbody_hyc_vb_sec_approver
            var fieldsToCheck = ['total', 'custbody_hyc_vb_manual_approval', 'custbody_hyc_vb_sec_approver'];

            // Get the field names from the record
            var fieldNames = newRecord.getFields();
    
            // Create an array to store fields that have changed
            var changedFields = [];
    
            // Iterate through the fields
            for (var i = 0; i < fieldNames.length; i++) {
                var fieldName = fieldNames[i];

                var reqCheck = false;

                fieldsToCheck.forEach(function (element) {
                    if (element === fieldName) {
                        reqCheck = true;
                    }
                });
    
                if (reqCheck) {
                    // Get the new and old values for the field
                    var newValue = newRecord.getValue({
                        fieldId: fieldName
                    });
                    var oldValue = oldRecord.getValue({
                        fieldId: fieldName
                    });
                    var field = newRecord.getField({
                        fieldId: fieldName
                    });

                    var message = 'fieldName = ' + fieldName + ', type = ' + field.type + ', newValue = ' + newValue + ' | oldValue = ' + oldValue;
        
                    // Compare the new and old values
                    if (field.type == 'date') {
                        var newDate = new Date(newValue);
                        var oldDate = new Date(oldValue);

                        if(newDate.getTime() !== oldDate.getTime()) {
                            changedFields.push(fieldName);
                        }
                    } else {
                        if (newValue !== oldValue) {
                            // Field has changed
                            changedFields.push(fieldName);
                        }
                    }
                }
            }

            return changedFields.length > 0;
        }

        return {
            beforeSubmit: beforeSubmit,
            afterSubmit: afterSubmit
        };

    });
