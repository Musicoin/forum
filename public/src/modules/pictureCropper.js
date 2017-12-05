'use strict';


define('pictureCropper', ['translator', 'cropper', 'benchpress'], function (translator, Cropper, Benchpress) {
	var module = {};

	module.show = function (data, callback) {
		var fileSize = data.hasOwnProperty('fileSize') && data.fileSize !== undefined ? parseInt(data.fileSize, 10) : false;
		parseModal({
			showHelp: data.hasOwnProperty('showHelp') && data.showHelp !== undefined ? data.showHelp : true,
			fileSize: fileSize,
			title: data.title || '[[global:upload_file]]',
			description: data.description || '',
			button: data.button || '[[global:upload]]',
			accept: data.accept ? data.accept.replace(/,/g, '&#44; ') : '',
		}, function (uploadModal) {
			uploadModal = $(uploadModal);

			uploadModal.modal('show');
			uploadModal.on('hidden.bs.modal', function () {
				uploadModal.remove();
			});

			uploadModal.find('#fileUploadSubmitBtn').on('click', function () {
				$(this).addClass('disabled');
				data.uploadModal = uploadModal;
				onSubmit(data, callback);
				return false;
			});
		});
	};

	module.handleImageCrop = function (data, callback) {
		$('#crop-picture-modal').remove();
		Benchpress.parse('modals/crop_picture', {
			url: data.url,
		}, function (cropperHtml) {
			translator.translate(cropperHtml, function (translated) {
				var cropperModal = $(translated);
				cropperModal.modal({
					backdrop: 'static',
				}).modal('show');

				// Set cropper image max-height based on viewport
				var cropBoxHeight = parseInt($(window).height() / 2, 10);
				var img = document.getElementById('cropped-image');
				$(img).css('max-height', cropBoxHeight);

				var cropperTool = new Cropper(img, {
					aspectRatio: data.aspectRatio,
					autoCropArea: 1,
					viewMode: 1,
					cropmove: function () {
						if (data.restrictImageDimension) {
							if (cropperTool.cropBoxData.width > data.imageDimension) {
								cropperTool.setCropBoxData({
									width: data.imageDimension,
								});
							}
							if (cropperTool.cropBoxData.height > data.imageDimension) {
								cropperTool.setCropBoxData({
									height: data.imageDimension,
								});
							}
						}
					},
					ready: function () {
						if (data.restrictImageDimension) {
							var origDimension = (img.width < img.height) ? img.width : img.height;
							var dimension = (origDimension > data.imageDimension) ? data.imageDimension : origDimension;
							cropperTool.setCropBoxData({
								width: dimension,
								height: dimension,
							});
						}

						cropperModal.find('.rotate').on('click', function () {
							var degrees = this.getAttribute('data-degrees');
							cropperTool.rotate(degrees);
						});

						cropperModal.find('.flip').on('click', function () {
							var option = this.getAttribute('data-option');
							var method = this.getAttribute('data-method');
							if (method === 'scaleX') {
								cropperTool.scaleX(option);
							} else {
								cropperTool.scaleY(option);
							}
							this.setAttribute('data-option', option * -1);
						});

						cropperModal.find('.reset').on('click', function () {
							cropperTool.reset();
						});

						cropperModal.find('.crop-btn').on('click', function () {
							$(this).addClass('disabled');
							var imageData = data.imageType ? cropperTool.getCroppedCanvas().toDataURL(data.imageType) : cropperTool.getCroppedCanvas().toDataURL();

							cropperModal.find('#upload-progress-bar').css('width', '100%');
							cropperModal.find('#upload-progress-box').show().removeClass('hide');

							var socketData = {};
							socketData[data.paramName] = data.paramValue;
							socketData.imageData = imageData;

							socket.emit(data.socketMethod, socketData, function (err, imageData) {
								if (err) {
									cropperModal.find('#upload-progress-box').hide();
									cropperModal.find('.upload-btn').removeClass('disabled');
									cropperModal.find('.crop-btn').removeClass('disabled');
									return app.alertError(err.message);
								}

								callback(imageData.url);
								cropperModal.modal('hide');
							});
						});

						cropperModal.find('.upload-btn').on('click', function () {
							$(this).addClass('disabled');
							cropperTool.destroy();

							cropperTool = new Cropper(img, {
								viewMode: 1,
								autoCropArea: 1,
								ready: function () {
									cropperModal.find('.crop-btn').trigger('click');
								},
							});
						});
					},
				});
			});
		});
	};

	function onSubmit(data, callback) {
		function showAlert(type, message) {
			module.hideAlerts(data.uploadModal);
			if (type === 'error') {
				data.uploadModal.find('#fileUploadSubmitBtn').removeClass('disabled');
			}
			data.uploadModal.find('#alert-' + type).translateText(message).removeClass('hide');
		}

		var fileInput = data.uploadModal.find('#fileInput');
		if (!fileInput.val()) {
			return showAlert('error', '[[uploads:select-file-to-upload]]');
		}

		var file = fileInput[0].files[0];
		var reader = new FileReader();
		var imageUrl;
		var imageType = file.type;

		reader.addEventListener('load', function () {
			imageUrl = reader.result;

			data.uploadModal.modal('hide');

			module.handleImageCrop({
				url: imageUrl,
				imageType: imageType,
				socketMethod: data.socketMethod,
				aspectRatio: data.aspectRatio,
				allowSkippingCrop: data.allowSkippingCrop,
				restrictImageDimension: data.restrictImageDimension,
				imageDimension: data.imageDimension,
				paramName: data.paramName,
				paramValue: data.paramValue,
			}, callback);
		}, false);

		if (file) {
			reader.readAsDataURL(file);
		}
	}

	function parseModal(tplVals, callback) {
		Benchpress.parse('partials/modals/upload_file_modal', tplVals, function (html) {
			translator.translate(html, callback);
		});
	}

	return module;
});
