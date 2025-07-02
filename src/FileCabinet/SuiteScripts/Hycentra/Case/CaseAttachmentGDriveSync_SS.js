/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define([
    'N/search',
    'N/record',
    'N/log',
    'N/file',
    'N/https',
    'N/runtime',
    'N/crypto',
    'N/encode',
    'N/task',
    'N/format'
], function (search, record, log, file, https, runtime, crypto, encode, task, format) {

    // ────────────────────────────
    // CONSTANTS
    // ────────────────────────────
    var GOOGLE_DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
    var UPLOAD_API_URL = 'https://www.googleapis.com/upload/drive/v3/files';
    var GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
    var PARENT_FOLDER_ID = '1fE_BLrw3RfmeAMe6zKxoBmNbUeg__y_b'; // Set this to your target Google Drive folder ID
    
    // Status codes for custevent_hyc_sqi_gdrive_upload_status
    var STATUS = {
        NOT_UPLOADED: 1,
        READY_FOR_UPLOAD: 2,
        UPLOADED: 3,
        FAILED: 4  // Changed from 99 to 4
    };

    // Supported file types (NetSuite file.Type enums)
    var SUPPORTED_TYPES = [
        file.Type.BMPIMAGE,
        file.Type.GIFIMAGE,
        file.Type.JPGIMAGE,
        file.Type.MPEGMOVIE,
        file.Type.PDF,
        file.Type.PJPGIMAGE,
        file.Type.PNGIMAGE,
        file.Type.TIFFIMAGE,
        file.Type.WEBPIMAGE,
        file.Type.ZIP
    ];

    // Mapping NetSuite file.Type to standard MIME types for Google Drive
    var MIME_TYPE_MAP = {};
    MIME_TYPE_MAP[file.Type.BMPIMAGE] = 'image/bmp';
    MIME_TYPE_MAP[file.Type.GIFIMAGE] = 'image/gif';
    MIME_TYPE_MAP[file.Type.JPGIMAGE] = 'image/jpeg';
    MIME_TYPE_MAP[file.Type.MPEGMOVIE] = 'video/mpeg';
    MIME_TYPE_MAP[file.Type.PDF] = 'application/pdf';
    MIME_TYPE_MAP[file.Type.PJPGIMAGE] = 'image/jpeg'; // Progressive JPEG
    MIME_TYPE_MAP[file.Type.PNGIMAGE] = 'image/png';
    MIME_TYPE_MAP[file.Type.TIFFIMAGE] = 'image/tiff';
    MIME_TYPE_MAP[file.Type.WEBPIMAGE] = 'image/webp';
    MIME_TYPE_MAP[file.Type.ZIP] = 'application/zip';
    // Add other video types if needed based on NetSuite's file.Type enumeration

    // ────────────────────────────
    // MAIN EXECUTION
    // ────────────────────────────
    function execute(context) {
        try {
            log.audit('CaseAttachmentGDriveSync', 'Starting Google Drive sync process');

            // Get script parameters
            var scriptObj = runtime.getCurrentScript();
            var parentFolderId = scriptObj.getParameter({ name: 'custscript_gdrive_parent_folder_id' }) || PARENT_FOLDER_ID;
            
            log.debug('Script Parameters', 'Parent Folder ID: ' + parentFolderId);
            
            // Try to get access token in order of preference:
            // 1. OAuth refresh token (recommended)
            // 2. Pre-generated access token
            // 3. External JWT service (if implemented)
            var accessToken = null;
            
            // Try refresh token first (most reliable)
            accessToken = getAccessTokenFromRefreshToken();
            
            if (!accessToken) {
                accessToken = getPreGeneratedAccessToken();
            }
            
            // Try external JWT service if available
            if (!accessToken) {
                accessToken = getAccessTokenFromExternalJWT();
            }

            if (!parentFolderId || !accessToken) {
                throw new Error('Missing required parameters: Google Drive folder ID and access token. Please set up OAuth refresh token or pre-generated access token.');
            }
            
            // Validate parent folder exists
            var folderValid = validateParentFolder(parentFolderId, accessToken);
            if (!folderValid) {
                throw new Error('Parent folder not found or not accessible: ' + parentFolderId + '. Please check the folder ID and permissions.');
            }

            // Step 1: Find eligible cases
            var eligibleCases = findEligibleCases();
            log.audit('Found Cases', 'Found ' + eligibleCases.length + ' eligible cases');

            var processedCount = 0;
            var errorCount = 0;

            // Process each case
            for (var i = 0; i < eligibleCases.length; i++) {
                try {
                    var caseData = eligibleCases[i];
                    log.debug('Processing Case', 'Case ID: ' + caseData.id + ', Case Number: ' + caseData.casenumber + ', Created Date: ' + caseData.createddate);

                    // Step 2: Create folder in Google Drive
                    var folderResult = createGoogleDriveFolder(caseData.casenumber, caseData.createddate, parentFolderId, accessToken);
                    
                    if (folderResult.success) {
                        // Step 3: Process case attachments
                        var uploadResult = processCaseAttachments(caseData.id, folderResult.folderId, accessToken);
                        
                        if (uploadResult.success) {
                            updateCaseStatus(caseData.id, STATUS.UPLOADED);
                            processedCount++;
                            log.audit('Case Completed', 'Successfully processed case: ' + caseData.casenumber);
                        } else {
                            updateCaseStatus(caseData.id, STATUS.FAILED);
                            errorCount++;
                            log.error('Case Failed', 'Failed to upload attachments for case: ' + caseData.casenumber);
                        }
                    } else {
                        updateCaseStatus(caseData.id, STATUS.FAILED);
                        errorCount++;
                        log.error('Folder Creation Failed', 'Failed to create folder for case: ' + caseData.casenumber);
                    }

                    // Check governance after processing each case
                    checkGovernance();

                } catch (caseError) {
                    log.error('Case Processing Error', 'Error processing case ' + caseData.casenumber + ': ' + caseError.message);
                    updateCaseStatus(caseData.id, STATUS.FAILED);
                    errorCount++;
                }
            }

            log.audit('Sync Complete', 'Processed: ' + processedCount + ', Errors: ' + errorCount);

            // Governance check to yield script if necessary
            checkGovernance();

        } catch (e) {
            log.error('Execute Error', e.message);
        }
    }

    // ────────────────────────────
    // AUTHENTICATION METHODS
    // ────────────────────────────
    
    // Method 1: OAuth Refresh Token (Recommended)
    function getAccessTokenFromRefreshToken() {
        try {
            var scriptObj = runtime.getCurrentScript();
            var refreshToken = scriptObj.getParameter({ name: 'custscript_gdrive_refresh_token' });
            var clientId = scriptObj.getParameter({ name: 'custscript_gdrive_client_id' });
            var clientSecret = scriptObj.getParameter({ name: 'custscript_gdrive_client_secret' });
            
            // Debug: Log parameter values (mask sensitive data)
            log.debug('OAuth Parameters', 'Client ID: ' + (clientId ? clientId.substring(0, 20) + '...' : 'MISSING'));
            log.debug('OAuth Parameters', 'Client Secret: ' + (clientSecret ? 'SET (length: ' + clientSecret.length + ')' : 'MISSING'));
            log.debug('OAuth Parameters', 'Refresh Token: ' + (refreshToken ? 'SET (length: ' + refreshToken.length + ')' : 'MISSING'));
            
            if (!refreshToken || !clientId || !clientSecret) {
                log.error('Refresh Token', 'Missing refresh token parameters');
                return null;
            }

            // Validate parameter formats
            if (clientId.indexOf('.apps.googleusercontent.com') === -1) {
                log.error('OAuth Validation', 'Client ID format appears incorrect - should end with .apps.googleusercontent.com');
            }

            var requestBody = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken) + 
                              '&client_id=' + encodeURIComponent(clientId) + 
                              '&client_secret=' + encodeURIComponent(clientSecret);

            log.debug('OAuth Request', 'Making request to: ' + GOOGLE_TOKEN_URL);
            log.debug('OAuth Request Body', 'Body length: ' + requestBody.length + ' characters');

            var response = https.post({
                url: GOOGLE_TOKEN_URL,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: requestBody
            });

            log.debug('OAuth Response', 'Status Code: ' + response.code);
            log.debug('OAuth Response', 'Response Body: ' + response.body);

            if (response.code === 200) {
                var tokenData = JSON.parse(response.body);
                log.audit('Refresh Token Success', 'Successfully refreshed access token');
                log.debug('Token Info', 'Access token length: ' + (tokenData.access_token ? tokenData.access_token.length : 'MISSING'));
                return tokenData.access_token;
            } else {
                log.error('Refresh Token Failed', 'HTTP ' + response.code + ' - Response: ' + response.body);
                
                // Additional debugging for common errors
                if (response.body && response.body.indexOf('invalid_client') !== -1) {
                    log.error('Debug Hint', 'invalid_client error - check Client ID and Secret are correct');
                }
                if (response.body && response.body.indexOf('invalid_grant') !== -1) {
                    log.error('Debug Hint', 'invalid_grant error - refresh token may be expired or invalid');
                }
                
                return null;
            }

        } catch (e) {
            log.error('getAccessTokenFromRefreshToken Error', e.message);
            log.error('Error Stack', e.stack);
            return null;
        }
    }

    // Method 2: Pre-generated Access Token
    function getPreGeneratedAccessToken() {
        try {
            var scriptObj = runtime.getCurrentScript();
            var accessToken = scriptObj.getParameter({ name: 'custscript_gdrive_access_token' });
            
            if (accessToken) {
                log.debug('Access Token', 'Using pre-generated access token');
                return accessToken;
            }
            
            return null;
        } catch (e) {
            log.error('getPreGeneratedAccessToken Error', e.message);
            return null;
        }
    }

    // Method 3: External JWT Service (Alternative to local JWT signing)
    function getAccessTokenFromExternalJWT() {
        try {
            var scriptObj = runtime.getCurrentScript();
            var jwtServiceUrl = scriptObj.getParameter({ name: 'custscript_gdrive_jwt_service_url' });
            var serviceAccountKeyPath = scriptObj.getParameter({ name: 'custscript_gdrive_service_account_key' });
            
            if (!jwtServiceUrl || !serviceAccountKeyPath) {
                log.debug('External JWT', 'Missing external JWT service parameters');
                return null;
            }

            // Load service account key
            var keyFile = file.load({ id: serviceAccountKeyPath });
            var serviceAccountKey = JSON.parse(keyFile.getContents());

            // Call external JWT service
            var response = https.post({
                url: jwtServiceUrl,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    client_email: serviceAccountKey.client_email,
                    private_key: serviceAccountKey.private_key,
                    scope: 'https://www.googleapis.com/auth/drive'
                })
            });

            if (response.code === 200) {
                var jwtData = JSON.parse(response.body);
                if (jwtData.access_token) {
                    log.audit('External JWT Success', 'Successfully obtained access token from external service');
                    return jwtData.access_token;
                }
            }

            log.error('External JWT Failed', 'Response: ' + response.body);
            return null;

        } catch (e) {
            log.error('getAccessTokenFromExternalJWT Error', e.message);
            return null;
        }
    }

    // ────────────────────────────
    // STEP 1: FIND ELIGIBLE CASES
    // ────────────────────────────
    function findEligibleCases() {
        try {
            var caseSearch = search.create({
                type: search.Type.SUPPORT_CASE,
                filters: [
                    ['custevent_hyc_sqi_is_created', search.Operator.IS, 'T'],
                    'and',
                    ['custevent_hyc_sqi_gdrive_upload_status', search.Operator.ANYOF, STATUS.READY_FOR_UPLOAD]
                ],
                columns: [
                    'internalid',
                    'casenumber',
                    'title',
                    'createddate',
                    'custevent_hyc_sqi_gdrive_upload_status'
                ]
            });

            var cases = [];
            var searchResults = caseSearch.run();
            var resultRange = searchResults.getRange({ start: 0, end: 1000 }); // Limit for governance

            for (var i = 0; i < resultRange.length; i++) {
                cases.push({
                    id: resultRange[i].getValue('internalid'),
                    casenumber: resultRange[i].getValue('casenumber'),
                    title: resultRange[i].getValue('title'),
                    createddate: resultRange[i].getValue('createddate')
                });
            }

            return cases;

        } catch (e) {
            log.error('findEligibleCases Error', e.message);
            return [];
        }
    }

    // ────────────────────────────
    // STEP 2: CREATE GOOGLE DRIVE FOLDER
    // ────────────────────────────
    
    function validateParentFolder(parentFolderId, accessToken) {
        try {
            log.debug('Validating Parent Folder', 'Checking folder ID: ' + parentFolderId);
            
            var response = https.get({
                url: GOOGLE_DRIVE_API_URL + '/files/' + parentFolderId + '?supportsAllDrives=true',
                headers: {
                    'Authorization': 'Bearer ' + accessToken
                }
            });

            if (response.code === 200) {
                var folderData = JSON.parse(response.body);
                log.debug('Parent Folder Valid', 'Folder name: ' + folderData.name + ', Type: ' + folderData.mimeType);
                return true;
            } else {
                log.error('Parent Folder Invalid', 'HTTP ' + response.code + ' - Response: ' + response.body);
                return false;
            }

        } catch (e) {
            log.error('validateParentFolder Error', e.message);
            return false;
        }
    }

    function createGoogleDriveFolder(caseNumber, createdDate, parentFolderId, accessToken) {
        try {
            var caseCreationDate = new Date(createdDate);

            var year = caseCreationDate.getFullYear().toString();
            var month = ('0' + (caseCreationDate.getMonth() + 1)).slice(-2);

            log.debug('Folder Structure', 'Year: ' + year + ', Month: ' + month);

            // 1. Get or create Year folder
            var yearFolderResult = getOrCreateFolder(year, parentFolderId, accessToken);
            if (!yearFolderResult.success) {
                return { success: false, error: yearFolderResult.error };
            }
            var yearFolderId = yearFolderResult.folderId;
            log.debug('Year Folder', 'Year Folder ID: ' + yearFolderId);

            // 2. Get or create Month folder within Year folder
            var monthFolderResult = getOrCreateFolder(month, yearFolderId, accessToken);
            if (!monthFolderResult.success) {
                return { success: false, error: monthFolderResult.error };
            }
            var monthFolderId = monthFolderResult.folderId;
            log.debug('Month Folder', 'Month Folder ID: ' + monthFolderId);

            // 3. Get or create Case Number folder within Month folder
            var caseFolderResult = getOrCreateFolder(caseNumber, monthFolderId, accessToken);
            if (!caseFolderResult.success) {
                return { success: false, error: caseFolderResult.error };
            }
            var caseFolderId = caseFolderResult.folderId;
            log.debug('Case Folder', 'Case Folder ID: ' + caseFolderId);

            return { success: true, folderId: caseFolderId };

        } catch (e) {
            log.error('createGoogleDriveFolder Error', e.message);
            return { success: false, error: e.message };
        }
    }

    function getOrCreateFolder(folderName, parentId, accessToken) {
        try {
            var folderId = checkFolderExists(folderName, parentId, accessToken);
            if (folderId) {
                log.debug('getOrCreateFolder', 'Folder already exists: ' + folderName + ' ID: ' + folderId);
                return { success: true, folderId: folderId };
            }

            // Folder does not exist, create it
            var createUrl = GOOGLE_DRIVE_API_URL + '/files';
            var headers = {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            };
            var postBody = JSON.stringify({
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentId]
            });

            log.debug('Creating Folder', 'Folder Name: ' + folderName + ', Parent ID: ' + parentId);

            var response = https.post({
                url: createUrl + '?supportsAllDrives=true',
                headers: headers,
                body: postBody
            });

            log.debug('Create Folder Response', 'Status: ' + response.code + ', Body: ' + response.body);

            if (response.code === 200) {
                var responseBody = JSON.parse(response.body);
                log.audit('Folder Creation Success', 'Successfully created folder: ' + folderName + ' with ID: ' + responseBody.id);
                return { success: true, folderId: responseBody.id };
            } else {
                var errorMsg = 'Failed to create folder ' + folderName + ': HTTP ' + response.code + ' - ' + response.body;
                log.error('Folder Creation Failed', errorMsg);
                return { success: false, error: errorMsg };
            }
        } catch (e) {
            log.error('getOrCreateFolder Error', e.message);
            return { success: false, error: e.message };
        }
    }

    function checkFolderExists(folderName, parentId, accessToken) {
        try {
            var query = "name='" + folderName + "' and parents in '" + parentId + "' and mimeType='application/vnd.google-apps.folder'";
            
            var response = https.get({
                url: GOOGLE_DRIVE_API_URL + '/files?q=' + encodeURIComponent(query) + '&supportsAllDrives=true',
                headers: {
                    'Authorization': 'Bearer ' + accessToken
                }
            });

            if (response.code === 200) {
                var data = JSON.parse(response.body);
                if (data.files && data.files.length > 0) {
                    return data.files[0].id;
                }
            }
            return null;

        } catch (e) {
            log.error('checkFolderExists Error', e.message);
            return null;
        }
    }

    // ────────────────────────────
    // STEP 3: PROCESS CASE ATTACHMENTS
    // ────────────────────────────
    function processCaseAttachments(caseId, folderId, accessToken) {
        try {
            // Find all message attachments for this case
            var attachments = getMessageAttachments(caseId);
            log.debug('Found Attachments', 'Found ' + attachments.length + ' attachments for case: ' + caseId);

            var uploadedCount = 0;
            var failedCount = 0;

            for (var i = 0; i < attachments.length; i++) {
                var attachment = attachments[i];
                
                // Check governance before processing each attachment
                checkGovernance();

                // Check if file type is supported
                if (isSupportedFileType(attachment.type)) {
                    var uploadResult = uploadFileToGoogleDrive(attachment, folderId, accessToken);
                    if (uploadResult.success) {
                        uploadedCount++;
                    } else {
                        failedCount++;
                    }
                } else {
                    log.debug('Skipped File', 'Unsupported file type: ' + attachment.type + ' for file: ' + attachment.name);
                }
            }

            log.audit('Upload Summary', 'Case ' + caseId + ' - Uploaded: ' + uploadedCount + ', Failed: ' + failedCount);
            return { success: failedCount === 0, uploadedCount: uploadedCount, failedCount: failedCount };

        } catch (e) {
            log.error('processCaseAttachments Error', e.message);
            return { success: false, error: e.message };
        }
    }

    function getMessageAttachments(caseId) {
        try {
            log.debug('getMessageAttachments', 'Attempting to load attachments record for case: ' + caseId);
    
            const messageSearchColAttachmentsInternalId = search.createColumn({ name: 'internalid', join: 'attachments' });
            const messageSearchColAttachmentsFolder = search.createColumn({ name: 'folder', join: 'attachments' });
            const messageSearchColAttachmentsHostedPath = search.createColumn({ name: 'hostedpath', join: 'attachments' });
            const messageSearchColAttachmentsName = search.createColumn({ name: 'name', join: 'attachments' });
            const messageSearchColAttachmentsOwner = search.createColumn({ name: 'owner', join: 'attachments' });
            const messageSearchColAttachmentsSizeKB = search.createColumn({ name: 'documentsize', join: 'attachments' });
            const messageSearchColAttachmentsType = search.createColumn({ name: 'filetype', join: 'attachments' });
            const messageSearchColAttachmentsURL = search.createColumn({ name: 'url', join: 'attachments' });
    
            // Load the message record to get attachments
            var attachmentRecords = search.create({
                type: search.Type.MESSAGE,
                filters: [
                   ["case.internalid","anyof",caseId]
                ],
                columns: [
                    messageSearchColAttachmentsInternalId,
                    messageSearchColAttachmentsName,
                    messageSearchColAttachmentsType,
                    messageSearchColAttachmentsSizeKB
                ]
             });
    
            var attachments = [];
    
            var attachmentResults = attachmentRecords.run().getRange({ start: 0, end: 1000 });
            var fileCount = attachmentResults.length;
            log.debug('getMessageAttachments', 'Found ' + fileCount + ' messages for case: ' + caseId);
    
            for (var i = 0; i < fileCount; i++) {
                var fileId = attachmentResults[i].getValue({name: 'internalid', join: 'attachments'});
    
                if (fileId) {
                    log.debug('getMessageAttachments', 'Found fileId: ' + fileId + ' on line: ' + i + ' for case: ' + caseId);
                    var fileObj = file.load({ id: fileId });
                    attachments.push({
                        id: fileId,
                        name: fileObj.name,
                        type: fileObj.fileType,
                        size: fileObj.size,
                        content: fileObj.getContents()
                    });
                } else {
                    log.debug('getMessageAttachments', 'No fileId found on line: ' + i + ' for case: ' + caseId);
                }
            }
    
            log.debug('getMessageAttachments', 'Total attachments found for case ' + caseId + ': ' + attachments.length);
            return attachments;
    
        } catch (e) {
            log.error('getMessageAttachments Error', 'Case ID: ' + caseId + ', Error: ' + e.message);
            return [];
        }
    }

    function isSupportedFileType(fileType) {
        return SUPPORTED_TYPES.indexOf(fileType) !== -1;
    }

    function uploadFileToGoogleDrive(attachment, folderId, accessToken) {
        try {
            log.debug('Upload File Debug', 'Attachment Name: ' + attachment.name + ', NetSuite File Type: ' + attachment.type);
            log.debug('Upload File Debug', 'Mapped MIME Type: ' + MIME_TYPE_MAP[attachment.type]);

            // Prepare metadata
            var metadata = {
                name: attachment.name,
                parents: [folderId]
            };

            // Create multipart upload
            var boundary = '-------314159265358979323846';
            var delimiter = "\r\n--" + boundary + "\r\n";
            var close_delim = "\r\n--" + boundary + "--";

            var body = delimiter +
                'Content-Type: application/json\r\n\r\n' +
                JSON.stringify(metadata) + delimiter +
                'Content-Type: ' + MIME_TYPE_MAP[attachment.type] + '\r\n' +
                'Content-Transfer-Encoding: base64\r\n\r\n' +
                attachment.content + close_delim;

            var response = https.post({
                url: UPLOAD_API_URL + '?uploadType=multipart&supportsAllDrives=true',
                headers: {
                    'Authorization': 'Bearer ' + accessToken,
                    'Content-Type': 'multipart/related; boundary="' + boundary + '"'
                },
                body: body
            });

            if (response.code === 200) {
                var fileData = JSON.parse(response.body);
                log.debug('File Uploaded', 'Uploaded: ' + attachment.name + ' to folder: ' + folderId);
                return { success: true, fileId: fileData.id };
            } else {
                log.error('File Upload Failed', 'File: ' + attachment.name + ', Response: ' + response.body);
                return { success: false, error: response.body };
            }

        } catch (e) {
            log.error('uploadFileToGoogleDrive Error', 'File: ' + attachment.name + ', Error: ' + e.message);
            return { success: false, error: e.message };
        }
    }

    // ────────────────────────────
    // UTILITY FUNCTIONS
    // ────────────────────────────
    function updateCaseStatus(caseId, status) {
        try {
            record.submitFields({
                type: record.Type.SUPPORT_CASE,
                id: caseId,
                values: {
                    'custevent_hyc_sqi_gdrive_upload_status': status
                }
            });
            log.debug('Status Updated', 'Case ' + caseId + ' status updated to: ' + status);
        } catch (e) {
            log.error('updateCaseStatus Error', 'Case: ' + caseId + ', Error: ' + e.message);
        }
    }

    // Governance check to yield script if necessary
    function checkGovernance() {
        var scriptObj = runtime.getCurrentScript();
        var remainingUsage = scriptObj.getRemainingUsage();
        
        // If less than 200 units remain, yield the script
        if (remainingUsage < 200) {
            log.audit('Governance Yield', 'Remaining usage: ' + remainingUsage + '. Yielding script.');
            var scriptTask = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT
            });
            scriptTask.scriptId = scriptObj.id;
            scriptTask.deploymentId = scriptObj.deploymentId;
            scriptTask.submit();
            
            throw 'Script yielded successfully.';
        }
    }

    // ────────────────────────────
    // EXPORTS
    // ────────────────────────────
    return {
        execute: execute
    };
});