/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 * @description Client script for PDF merging from custom record URLs
 */
define(['N/log', 'N/record', 'N/url', 'N/currentRecord'],
    function (log, record, url, currentRecord) {

        const MERGE_PDF_ACTION = {
            PRINT_STARTED: 'printStarted',
            PRINT_FINISHED: 'printFinished',
        };

        /**
         * Function to be executed after page is initialized.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.mode - The mode in which the record is being accessed (create, copy, or edit)
         * @since 2015.2
         */
        async function pageInit(scriptContext) {
            try {
                console.log('PDF Merge Client Script initialized');

                // Inject PDF-lib library
                await injectPDFLib();

                // Insert CSS styles
                insertCSS();

                // Insert loading overlay
                insertLoadingOverlay();

                // Get URLs and settings from hidden fields
                const currentRec = scriptContext.currentRecord;
                const fileUrlsJson = currentRec.getValue('custpage_file_urls');
                const mergeRequestId = currentRec.getValue('custpage_merge_request_id');
                const openInWebValue = currentRec.getValue('custpage_open_in_web');
                const openInWeb = openInWebValue !== 'false'; // Default true

                if (!fileUrlsJson) {
                    showError('No file URLs found for merging');
                    return;
                }

                let fileUrls;
                try {
                    fileUrls = JSON.parse(fileUrlsJson);
                } catch (parseError) {
                    console.error('Failed to parse file URLs:', parseError);
                    showError('Invalid file URL data');
                    return;
                }

                if (!Array.isArray(fileUrls) || fileUrls.length === 0) {
                    showError('No valid file URLs found for merging');
                    return;
                }

                console.log('Starting PDF merge for', fileUrls.length, 'files', openInWeb ? '(open in web)' : '(download)');

                // Start the merge process
                setTimeout(() => {
                    fetchAndMergePDFs(fileUrls, mergeRequestId, openInWeb);
                }, 1000);

            } catch (error) {
                log.error('pageInit Error', error);
                console.error('pageInit Error', error);
                showError('Initialization failed: ' + error.message);
            }
        }

        /**
         * Inject PDF-lib library
         */
        function injectPDFLib() {
            return new Promise((resolve, reject) => {
                if (window.PDFLib) {
                    resolve();
                    return;
                }

                const script = document.createElement('script');
                script.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
                script.onload = () => {
                    console.log('PDF-lib loaded successfully');
                    resolve();
                };
                script.onerror = () => {
                    console.error('Failed to load PDF-lib');
                    reject(new Error('Failed to load PDF-lib library'));
                };

                (document.head || document.documentElement).appendChild(script);
            });
        }

        /**
         * Insert CSS styles
         */
        function insertCSS() {
            const style = document.createElement('style');
            style.innerHTML = `
                .loading-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.8);
                    color: white;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    font-size: 18px;
                    z-index: 9999;
                }
                
                .progress-container {
                    width: 300px;
                    background-color: #333;
                    border-radius: 10px;
                    padding: 3px;
                    margin: 20px 0;
                }
                
                .progress-bar {
                    background-color: #007cba;
                    height: 20px;
                    border-radius: 7px;
                    width: 0%;
                    transition: width 0.3s ease;
                }
                
                .file-status {
                    margin-top: 20px;
                    max-width: 400px;
                    text-align: center;
                }
                
                .error-message {
                    color: #ff6b6b;
                    background-color: #2d1b1b;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px;
                    border: 1px solid #ff6b6b;
                }
            `;
            document.head.appendChild(style);
        }

        /**
         * Insert loading overlay
         */
        function insertLoadingOverlay() {
            const overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.id = 'loadingOverlay';
            overlay.innerHTML = `
                <div>Processing PDF Merge...</div>
                <div class="progress-container">
                    <div class="progress-bar" id="progressBar"></div>
                </div>
                <div class="file-status" id="fileStatus">Initializing...</div>
            `;
            document.body.appendChild(overlay);
        }

        /**
         * Hide the loading overlay
         */
        function hideLoadingOverlay() {
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) {
                overlay.style.display = 'none';
            }
        }

        /**
         * Update the loading progress
         */
        function updateProgress(current, total, message) {
            const progressBar = document.getElementById('progressBar');
            const fileStatus = document.getElementById('fileStatus');

            if (progressBar) {
                const progress = (current / total) * 100;
                progressBar.style.width = progress + '%';
            }

            if (fileStatus) {
                fileStatus.textContent = message;
            }
        }

        /**
         * Show error message
         */
        function showError(message) {
            hideLoadingOverlay();

            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.innerHTML = `
                <h3>Error</h3>
                <p>${message}</p>
                <button onclick="window.close()" style="margin-top: 10px; padding: 8px 16px; background-color: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer;">
                    Close Window
                </button>
            `;

            document.body.appendChild(errorDiv);
        }

        /**
         * Download PDF file
         * @param {string} downloadUrl - URL to download
         * @param {string} fileName - Filename for download
         */
        function downloadPDF(downloadUrl, fileName) {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        /**
         * Sanitize filename
         */
        function sanitizeFileName(filename) {
            return filename.replace(/[\/\\:*?"<>|]/g, '_');
        }

        /**
         * Fetch and merge PDFs
         * @param {Array} fileUrls - Array of file URLs to merge
         * @param {string} mergeRequestId - ID of the merge request record
         * @param {boolean} openInWeb - Whether to open PDF in web or download it
         */
        async function fetchAndMergePDFs(fileUrls, mergeRequestId, openInWeb = true) {
            try {
                updateProgress(0, fileUrls.length, 'Creating new PDF document...');

                const mergedPdfDoc = await PDFLib.PDFDocument.create();
                const baseURL = 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION });

                // Process each URL
                for (let i = 0; i < fileUrls.length; i++) {
                    const fileUrl = fileUrls[i];
                    const fullUrl = fileUrl.startsWith('http') ? fileUrl : baseURL + fileUrl;

                    try {
                        updateProgress(i, fileUrls.length, `Processing file ${i + 1} of ${fileUrls.length}...`);

                        console.log('Processing file:', fullUrl);

                        // Fetch the file
                        const response = await fetch(fullUrl);
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }

                        const fileData = await response.arrayBuffer();
                        const contentType = response.headers.get('Content-Type') || '';

                        // A4 dimensions in points
                        const pageWidth = 595.28;
                        const pageHeight = 841.89;

                        if (contentType.includes('application/pdf') || fullUrl.toLowerCase().includes('.pdf')) {
                            // Handle PDF files
                            const pdfDoc = await PDFLib.PDFDocument.load(fileData);
                            const pages = await mergedPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
                            pages.forEach((page) => mergedPdfDoc.addPage(page));

                        } else if (contentType.includes('image/') || /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fullUrl)) {
                            // Handle image files
                            const imageBytes = new Uint8Array(fileData);
                            let embeddedImage;

                            try {
                                if (contentType.includes('image/jpeg') || /\.(jpg|jpeg)$/i.test(fullUrl)) {
                                    embeddedImage = await mergedPdfDoc.embedJpg(imageBytes);
                                } else if (contentType.includes('image/png') || fullUrl.toLowerCase().includes('.png')) {
                                    embeddedImage = await mergedPdfDoc.embedPng(imageBytes);
                                } else {
                                    // Try PNG first, then JPG
                                    try {
                                        embeddedImage = await mergedPdfDoc.embedPng(imageBytes);
                                    } catch {
                                        embeddedImage = await mergedPdfDoc.embedJpg(imageBytes);
                                    }
                                }

                                if (embeddedImage) {
                                    // Calculate scaling to fit page while maintaining aspect ratio
                                    const imageDims = embeddedImage.scale(1);
                                    const imageWidth = imageDims.width;
                                    const imageHeight = imageDims.height;

                                    const widthScale = pageWidth / imageWidth;
                                    const heightScale = pageHeight / imageHeight;

                                    let scale = Math.min(widthScale, heightScale);
                                    if (scale > 1) scale = 1; // Don't upscale images

                                    const scaledWidth = imageWidth * scale;
                                    const scaledHeight = imageHeight * scale;

                                    // Add a new page and center the image
                                    const page = mergedPdfDoc.addPage([pageWidth, pageHeight]);
                                    const x = (pageWidth - scaledWidth) / 2;
                                    const y = (pageHeight - scaledHeight) / 2;

                                    page.drawImage(embeddedImage, {
                                        x, y,
                                        width: scaledWidth,
                                        height: scaledHeight
                                    });
                                }
                            } catch (imageError) {
                                console.warn('Image processing error for file', i + 1, ':', imageError);
                            }

                        } else {
                            console.warn(`Unsupported file type: ${contentType} for file ${i + 1}`);
                        }

                    } catch (fileError) {
                        console.error(`Error processing file ${i + 1}:`, fileError);
                        // Continue with next file instead of failing completely
                    }
                }

                // Generate final PDF
                updateProgress(fileUrls.length, fileUrls.length, 'Generating final PDF...');

                const mergedPdfBytes = await mergedPdfDoc.save();
                const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
                const downloadUrl = URL.createObjectURL(blob);

                // Generate filename
                const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
                const fileName = sanitizeFileName(`merged_pdf_${timestamp}.pdf`);

                if (openInWeb) {
                    const turl = URL.createObjectURL(blob);
                    window.open(turl, '_blank');
                    // // Open PDF in new tab/window
                    // const pdfWindow = window.open(downloadUrl, '_blank');
                    // if (!pdfWindow) {
                    //     // Fallback to download if popup blocked
                    //     downloadPDF(downloadUrl, fileName);
                    // }
                } else {
                    // Download the file
                    downloadPDF(downloadUrl, fileName);
                }

                // Hide loading overlay
                hideLoadingOverlay();

                // Trigger completion Suitelet
                setTimeout(() => {
                    triggerCompletionSuitelet(mergeRequestId);
                }, 1000);

            } catch (error) {
                console.error('PDF merge error:', error);
                showError('PDF merge failed: ' + error.message);
            }
        }

        /**
         * Trigger the completion Suitelet
         */
        function triggerCompletionSuitelet(mergeRequestId) {
            try {
                const suiteletURL = url.resolveScript({
                    scriptId: 'customscript_con_sl_pdf_merge_cr', // Update with actual script ID
                    deploymentId: 'customdeploy_con_sl_pdf_merge_cr', // Update with actual deployment ID
                    returnExternalUrl: false
                });

                const completionUrl = suiteletURL +
                    '&action=' + MERGE_PDF_ACTION.PRINT_FINISHED +
                    '&mergeRequestId=' + mergeRequestId;

                console.log('Redirecting to completion page');
                window.location.href = completionUrl;

            } catch (error) {
                console.error('Error triggering completion:', error);
                // Just close the window if we can't redirect
                setTimeout(() => {
                    window.close();
                }, 2000);
            }
        }

        return {
            pageInit: pageInit
        };
    });
