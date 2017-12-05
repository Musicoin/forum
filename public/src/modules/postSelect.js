'use strict';


define('postSelect', ['components'], function (components) {
	var PostSelect = {};

	PostSelect.pids = [];

	PostSelect.init = function (onSelect) {
		PostSelect.pids.length = 0;
		components.get('topic').on('click', '[data-pid]', function () {
			togglePostSelection($(this), onSelect);
		});
		disableClicksOnPosts();
	};


	function togglePostSelection(post, callback) {
		var newPid = post.attr('data-pid');

		if (parseInt(post.attr('data-index'), 10) === 0) {
			return;
		}

		if (newPid) {
			var index = PostSelect.pids.indexOf(newPid);
			if (index === -1) {
				PostSelect.pids.push(newPid);
				post.toggleClass('bg-success', true);
			} else {
				PostSelect.pids.splice(index, 1);
				post.toggleClass('bg-success', false);
			}

			if (PostSelect.pids.length) {
				PostSelect.pids.sort(function (a, b) { return a - b; });
			}
			callback();
		}
	}


	function disableClicks() {
		return false;
	}

	function disableClicksOnPosts() {
		components.get('post').on('click', 'button,a', disableClicks);
	}

	PostSelect.enableClicksOnPosts = function () {
		components.get('post').off('click', 'button,a', disableClicks);
	};


	return PostSelect;
});
