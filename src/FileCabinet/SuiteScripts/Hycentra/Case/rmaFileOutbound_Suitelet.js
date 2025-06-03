/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/email', 'N/render', 'N/record', 'N/runtime'], function (email, render, record, runtime) {
    function onRequest(context) {
        // Configuration
        var emailTemplateId = 169; // email template internal ID
        var recipientId = 1021; // 54058 = James @ Hycentra
        var authorId = 1021;  // Employee: RMA Department

        // Parameters
        var caseId = context.request.parameters.caseid;
        
        // Load the template with the  provided Case ID
        const template = render.mergeEmail({
            templateId: emailTemplateId,
            supportCaseId: Number(caseId)
        })
        
        // Send the email with the provided template
        email.send({
            author: authorId,
            recipients: recipientId,
            subject: template.subject,
            body: template.body
        });
        
        // Load the Case Record
        var caseRecord = record.load({
            type: record.Type.SUPPORT_CASE,
            id: caseId
        });

        var caseNumber = caseRecord.getValue({ fieldId: 'casenumber' })

        // Update the email sent flag
        caseRecord.setValue({
            fieldId: 'custevent_hyc_rmafileoutboundclaim',
            value: true
            });
        caseRecord.save();
            
        // Response the output
        context.response.write('Email sent for case: ' + caseNumber);
    }

    return {
        onRequest: onRequest
    };
});