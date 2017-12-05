'use strict';


define('forum/footer', ['notifications', 'chat', 'components', 'translator'], function (Notifications, Chat, components, translator) {
	Notifications.prepareDOM();
	Chat.prepareDOM();
	translator.prepareDOM();

	function updateUnreadTopicCount(url, count) {
		if (!utils.isNumber(count)) {
			return;
		}
		$('a[href="' + config.relative_path + url + '"].navigation-link i')
			.toggleClass('unread-count', count > 0)
			.attr('data-content', count > 99 ? '99+' : count);
	}

	function updateUnreadChatCount(count) {
		components.get('chat/icon')
			.toggleClass('unread-count', count > 0)
			.attr('data-content', count > 99 ? '99+' : count);
	}

	function initUnreadTopics() {
		var unreadTopics = {};

		function onNewPost(data) {
			if (data && data.posts && data.posts.length) {
				var post = data.posts[0];

				if (parseInt(post.uid, 10) !== parseInt(app.user.uid, 10) && !unreadTopics[post.topic.tid]) {
					increaseUnreadCount(data);
					markTopicsUnread(post.topic.tid);
					unreadTopics[post.topic.tid] = true;
				}
			}
		}

		function increaseUnreadCount(data) {
			var post = data.posts[0];

			var unreadTopicCount = parseInt($('a[href="' + config.relative_path + '/unread"].navigation-link i').attr('data-content'), 10) + 1;
			updateUnreadTopicCount('/unread', unreadTopicCount);

			var isNewTopic = post.isMain && parseInt(post.uid, 10) !== parseInt(app.user.uid, 10);
			if (isNewTopic) {
				var unreadNewTopicCount = parseInt($('a[href="' + config.relative_path + '/unread/new"].navigation-link i').attr('data-content'), 10) + 1;
				updateUnreadTopicCount('/unread/new', unreadNewTopicCount);
			}
			socket.emit('topics.isFollowed', post.topic.tid, function (err, isFollowed) {
				if (err) {
					return app.alertError(err.message);
				}
				if (isFollowed) {
					var unreadWatchedTopicCount = parseInt($('a[href="' + config.relative_path + '/unread/watched"].navigation-link i').attr('data-content'), 10) + 1;
					updateUnreadTopicCount('/unread/watched', unreadWatchedTopicCount);
				}
			});
		}

		function markTopicsUnread(tid) {
			$('[data-tid="' + tid + '"]').addClass('unread');
		}

		$(window).on('action:ajaxify.end', function (ev, data) {
			if (data.url) {
				var tid = data.url.match(/^topic\/(\d+)/);

				if (tid && tid[1]) {
					delete unreadTopics[tid[1]];
				}
			}
		});

		socket.on('event:new_post', onNewPost);
	}

	if (app.user.uid) {
		socket.emit('user.getUnreadCounts', function (err, data) {
			if (err) {
				return app.alert(err.message);
			}

			updateUnreadCounters(data);

			updateUnreadChatCount(data.unreadChatCount);
			Notifications.updateNotifCount(data.unreadNotificationCount);
		});
	}

	function updateUnreadCounters(data) {
		updateUnreadTopicCount('/unread', data.unreadTopicCount);
		updateUnreadTopicCount('/unread/new', data.unreadNewTopicCount);
		updateUnreadTopicCount('/unread/watched', data.unreadWatchedTopicCount);
	}

	socket.on('event:unread.updateCount', updateUnreadCounters);
	socket.on('event:unread.updateChatCount', updateUnreadChatCount);

	initUnreadTopics();
});
