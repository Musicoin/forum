
'use strict';


define('autocomplete', function () {
	var module = {};

	module.user = function (input, onselect) {
		app.loadJQueryUI(function () {
			input.autocomplete({
				delay: 200,
				open: function () {
					$(this).autocomplete('widget').css('z-index', 20000);
				},
				select: onselect,
				source: function (request, response) {
					socket.emit('user.search', { query: request.term }, function (err, result) {
						if (err) {
							return app.alertError(err.message);
						}

						if (result && result.users) {
							var names = result.users.map(function (user) {
								var username = $('<div/>').html(user.username).text();
								return user && {
									label: username,
									value: username,
									user: {
										uid: user.uid,
										name: user.username,
										slug: user.userslug,
									},
								};
							});
							response(names);
						}
						$('.ui-autocomplete a').attr('data-ajaxify', 'false');
					});
				},
			});
		});
	};

	module.group = function (input, onselect) {
		app.loadJQueryUI(function () {
			input.autocomplete({
				delay: 200,
				select: onselect,
				source: function (request, response) {
					socket.emit('groups.search', {
						query: request.term,
					}, function (err, results) {
						if (err) {
							return app.alertError(err.message);
						}

						if (results && results.length) {
							var names = results.map(function (group) {
								return group && {
									label: group.name,
									value: group.name,
									group: {
										name: group.name,
										slug: group.slug,
									},
								};
							});
							response(names);
						}
						$('.ui-autocomplete a').attr('data-ajaxify', 'false');
					});
				},
			});
		});
	};

	module.tag = function (input, onselect) {
		app.loadJQueryUI(function () {
			input.autocomplete({
				delay: 100,
				open: function () {
					$(this).autocomplete('widget').css('z-index', 20000);
				},
				select: function (event, ui) {
					onselect = onselect || function () {};
					var e = jQuery.Event('keypress');
					e.which = 13;
					e.keyCode = 13;
					setTimeout(function () {
						input.trigger(e);
					}, 100);
					onselect(event, ui);
				},
				source: function (request, response) {
					socket.emit('topics.autocompleteTags', {
						query: request.term,
						cid: ajaxify.data.cid || 0,
					}, function (err, tags) {
						if (err) {
							return app.alertError(err.message);
						}
						if (tags) {
							response(tags);
						}
						$('.ui-autocomplete a').attr('data-ajaxify', 'false');
					});
				},
			});
		});
	};

	return module;
});
