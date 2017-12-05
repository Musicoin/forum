'use strict';


define('chat', [
	'components',
	'taskbar',
	'string',
	'sounds',
	'forum/chats',
	'forum/chats/messages',
	'translator',
	'scrollStop',
	'benchpress',
], function (components, taskbar, S, sounds, Chats, ChatsMessages, translator, scrollStop, Benchpress) {
	var module = {};
	var newMessage = false;

	module.prepareDOM = function () {
		var chatsToggleEl = components.get('chat/dropdown');
		var chatsListEl = components.get('chat/list');

		chatsToggleEl.on('click', function () {
			if (chatsToggleEl.parent().hasClass('open')) {
				return;
			}

			module.loadChatsDropdown(chatsListEl);
		});

		chatsListEl.on('click', '[data-roomid]', function (ev) {
			if ($(ev.target).parents('.user-link').length) {
				return;
			}
			var roomId = $(this).attr('data-roomid');
			if (!ajaxify.currentPage.match(/^chats\//)) {
				app.openChat(roomId);
			} else {
				ajaxify.go('user/' + app.user.userslug + '/chats/' + roomId);
			}
		});

		$('[component="chats/mark-all-read"]').on('click', function () {
			socket.emit('modules.chats.markAllRead', function (err) {
				if (err) {
					return app.alertError(err);
				}
			});
		});

		socket.on('event:chats.receive', function (data) {
			var username = data.message.fromUser.username;
			var isSelf = data.self === 1;
			data.message.self = data.self;

			newMessage = data.self === 0;
			if (module.modalExists(data.roomId)) {
				var modal = module.getModal(data.roomId);

				ChatsMessages.appendChatMessage(modal.find('.chat-content'), data.message);

				if (modal.is(':visible')) {
					taskbar.updateActive(modal.attr('UUID'));
					ChatsMessages.scrollToBottom(modal.find('.chat-content'));
				} else {
					module.toggleNew(modal.attr('UUID'), true, true);
				}

				if (!isSelf && (!modal.is(':visible') || !app.isFocused)) {
					app.alternatingTitle('[[modules:chat.user_has_messaged_you, ' + username + ']]');
					sounds.play('chat-incoming', 'chat.incoming:' + data.message.mid);

					taskbar.push('chat', modal.attr('UUID'), {
						title: data.roomName || username,
						touid: data.message.fromUser.uid,
						roomId: data.roomId,
					});
				}
			} else {
				socket.emit('modules.chats.loadRoom', {
					roomId: data.roomId,
				}, function (err, roomData) {
					if (err) {
						return app.alertError(err.message);
					}
					roomData.users = roomData.users.filter(function (user) {
						return user && parseInt(user.uid, 10) !== parseInt(app.user.uid, 10);
					});
					roomData.silent = true;
					roomData.uid = app.user.uid;
					module.createModal(roomData, function (modal) {
						module.toggleNew(modal.attr('UUID'), !isSelf, true);
						if (!isSelf) {
							app.alternatingTitle('[[modules:chat.user_has_messaged_you, ' + username + ']]');
							sounds.play('chat-incoming', 'chat.incoming:' + data.message.mid);
						}
					});
				});
			}
		});

		socket.on('event:user_status_change', function (data) {
			var modal = module.getModal(data.uid);
			app.updateUserStatus(modal.find('[component="user/status"]'), data.status);
		});

		socket.on('event:chats.roomRename', function (data) {
			var newTitle = $('<div/>').html(data.newName).text();
			var modal = module.getModal(data.roomId);
			modal.find('[component="chat/room/name"]').val(newTitle);
			taskbar.updateTitle('chat', modal.attr('UUID'), newTitle);
		});

		ChatsMessages.onChatMessageEdit();
	};

	module.loadChatsDropdown = function (chatsListEl) {
		socket.emit('modules.chats.getRecentChats', {
			uid: app.user.uid,
			after: 0,
		}, function (err, data) {
			if (err) {
				return app.alertError(err.message);
			}

			var rooms = data.rooms.filter(function (room) {
				return room.teaser;
			});

			Benchpress.parse('partials/chats/dropdown', {
				rooms: rooms,
			}, function (html) {
				translator.translate(html, function (translated) {
					chatsListEl.empty().html(translated);
					app.createUserTooltips(chatsListEl, 'right');
				});
			});
		});
	};

	module.bringModalToTop = function (chatModal) {
		var topZ = 0;

		taskbar.updateActive(chatModal.attr('UUID'));

		if ($('.chat-modal').length === 1) {
			return;
		}
		$('.chat-modal').each(function () {
			var thisZ = parseInt($(this).css('zIndex'), 10);
			if (thisZ > topZ) {
				topZ = thisZ;
			}
		});

		chatModal.css('zIndex', topZ + 1);
	};

	module.getModal = function (roomId) {
		return $('#chat-modal-' + roomId);
	};

	module.modalExists = function (roomId) {
		return $('#chat-modal-' + roomId).length !== 0;
	};

	module.createModal = function (data, callback) {
		app.parseAndTranslate('chat', data, function (chatModal) {
			var uuid = utils.generateUUID();
			var dragged = false;

			chatModal.attr('id', 'chat-modal-' + data.roomId);
			chatModal.attr('data-roomid', data.roomId);
			chatModal.attr('intervalId', 0);
			chatModal.attr('UUID', uuid);
			chatModal.css('position', 'fixed');
			chatModal.css('zIndex', 100);
			chatModal.appendTo($('body'));
			chatModal.find('.timeago').timeago();
			module.center(chatModal);

			app.loadJQueryUI(function () {
				chatModal.find('.modal-content').resizable({
					handles: 'n, e, s, w, se',
					minHeight: 250,
					minWidth: 400,
				});

				chatModal.find('.modal-content').on('resize', function (event, ui) {
					if (ui.originalSize.height === ui.size.height) {
						return;
					}

					chatModal.find('.chat-content').css('height', module.calculateChatListHeight(chatModal));
				});

				chatModal.draggable({
					start: function () {
						module.bringModalToTop(chatModal);
					},
					stop: function () {
						chatModal.find('#chat-message-input').focus();
					},
					distance: 10,
					handle: '.modal-header',
				});
			});

			scrollStop.apply(chatModal.find('[component="chat/messages"]'));

			chatModal.find('#chat-close-btn').on('click', function () {
				module.close(chatModal);
			});

			function gotoChats() {
				var text = components.get('chat/input').val();
				$(window).one('action:ajaxify.end', function () {
					components.get('chat/input').val(text);
				});

				ajaxify.go('user/' + app.user.userslug + '/chats/' + chatModal.attr('data-roomid'));
				module.close(chatModal);
			}

			chatModal.find('.modal-header').on('dblclick', gotoChats);
			chatModal.find('button[data-action="maximize"]').on('click', gotoChats);
			chatModal.find('button[data-action="minimize"]').on('click', function () {
				var uuid = chatModal.attr('uuid');
				module.minimize(uuid);
			});

			chatModal.on('click', function () {
				module.bringModalToTop(chatModal);

				if (dragged) {
					dragged = false;
				}
			});

			chatModal.on('mousemove', function (e) {
				if (e.which === 1) {
					dragged = true;
				}
			});

			chatModal.on('mousemove keypress click', function () {
				if (newMessage) {
					socket.emit('modules.chats.markRead', data.roomId);
					newMessage = false;
				}
			});

			Chats.addEditDeleteHandler(chatModal.find('[component="chat/messages"]'), data.roomId);

			chatModal.find('[component="chat/controlsToggle"]').on('click', function () {
				var messagesEl = chatModal.find('[component="chat/messages"]');

				chatModal.find('[component="chat/controls"]').toggle();
				messagesEl.css('height', module.calculateChatListHeight(chatModal));
			});

			Chats.addRenameHandler(chatModal.attr('data-roomid'), chatModal.find('[component="chat/room/name"]'));

			Chats.addSendHandlers(chatModal.attr('data-roomid'), chatModal.find('#chat-message-input'), chatModal.find('#chat-message-send-btn'));

			Chats.createTagsInput(chatModal.find('.users-tag-input'), data);
			Chats.createAutoComplete(chatModal.find('[component="chat/input"]'));

			Chats.addScrollHandler(chatModal.attr('data-roomid'), data.uid, chatModal.find('.chat-content'));

			Chats.addCharactersLeftHandler(chatModal);

			taskbar.push('chat', chatModal.attr('UUID'), {
				title: data.roomName || (data.users.length ? data.users[0].username : ''),
				roomId: data.roomId,
				icon: 'fa-comment',
				state: '',
			});

			$(window).trigger('action:chat.loaded', chatModal);

			if (typeof callback === 'function') {
				callback(chatModal);
			}
		});
	};

	module.focusInput = function (chatModal) {
		chatModal.find('#chat-message-input').focus();
	};

	module.close = function (chatModal) {
		clearInterval(chatModal.attr('intervalId'));
		chatModal.attr('intervalId', 0);
		chatModal.remove();
		chatModal.data('modal', null);
		taskbar.discard('chat', chatModal.attr('UUID'));

		if (chatModal.attr('data-mobile')) {
			module.disableMobileBehaviour(chatModal);
		}
	};

	module.center = function (chatModal) {
		var hideAfter = false;
		if (chatModal.hasClass('hide')) {
			chatModal.removeClass('hide');
			hideAfter = true;
		}
		chatModal.css('left', Math.max(0, (($(window).width() - $(chatModal).outerWidth()) / 2) + $(window).scrollLeft()) + 'px');
		chatModal.css('top', Math.max(0, ($(window).height() / 2) - ($(chatModal).outerHeight() / 2)) + 'px');

		if (hideAfter) {
			chatModal.addClass('hide');
		}
		return chatModal;
	};

	module.load = function (uuid) {
		var chatModal = $('div[UUID="' + uuid + '"]');
		chatModal.removeClass('hide');
		taskbar.updateActive(uuid);
		ChatsMessages.scrollToBottom(chatModal.find('.chat-content'));
		module.bringModalToTop(chatModal);
		module.focusInput(chatModal);
		socket.emit('modules.chats.markRead', chatModal.attr('data-roomid'));

		var env = utils.findBootstrapEnvironment();
		if (env === 'xs' || env === 'sm') {
			module.enableMobileBehaviour(chatModal);
		}
	};

	module.enableMobileBehaviour = function (modalEl) {
		app.toggleNavbar(false);
		modalEl.attr('data-mobile', '1');
		var messagesEl = modalEl.find('.chat-content');
		messagesEl.css('height', module.calculateChatListHeight(modalEl));

		$(window).on('resize', function () {
			messagesEl.css('height', module.calculateChatListHeight(modalEl));
		});
	};

	module.disableMobileBehaviour = function () {
		app.toggleNavbar(true);
	};

	module.calculateChatListHeight = function (modalEl) {
		var totalHeight = modalEl.find('.modal-content').outerHeight() - modalEl.find('.modal-header').outerHeight();
		var padding = parseInt(modalEl.find('.modal-body').css('padding-top'), 10) + parseInt(modalEl.find('.modal-body').css('padding-bottom'), 10);
		var contentMargin = parseInt(modalEl.find('.chat-content').css('margin-top'), 10) + parseInt(modalEl.find('.chat-content').css('margin-bottom'), 10);
		var inputGroupHeight = modalEl.find('.input-group').outerHeight();

		return totalHeight - padding - contentMargin - inputGroupHeight;
	};

	module.minimize = function (uuid) {
		var chatModal = $('div[UUID="' + uuid + '"]');
		chatModal.addClass('hide');
		taskbar.minimize('chat', uuid);
		clearInterval(chatModal.attr('intervalId'));
		chatModal.attr('intervalId', 0);
	};

	module.toggleNew = taskbar.toggleNew;


	return module;
});
