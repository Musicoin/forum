'use strict';


define('forum/search', ['search', 'autocomplete', 'storage'], function (searchModule, autocomplete, storage) {
	var	Search = {};

	Search.init = function () {
		var searchQuery = $('#results').attr('data-search-query');

		var searchIn = $('#search-in');

		searchIn.on('change', function () {
			updateFormItemVisiblity(searchIn.val());
		});

		highlightMatches(searchQuery);

		$('#advanced-search').off('submit').on('submit', function (e) {
			e.preventDefault();
			searchModule.query(getSearchDataFromDOM(), function () {
				$('#search-input').val('');
			});
			return false;
		});

		handleSavePreferences();

		enableAutoComplete();

		fillOutForm();
	};

	function getSearchDataFromDOM() {
		var form = $('#advanced-search');
		var searchData = {
			in: $('#search-in').val(),
		};
		searchData.term = $('#search-input').val();
		if (searchData.in === 'posts' || searchData.in === 'titlesposts' || searchData.in === 'titles') {
			searchData.by = form.find('#posted-by-user').val();
			searchData.categories = form.find('#posted-in-categories').val();
			searchData.searchChildren = form.find('#search-children').is(':checked');
			searchData.hasTags = form.find('#has-tags').tagsinput('items');
			searchData.replies = form.find('#reply-count').val();
			searchData.repliesFilter = form.find('#reply-count-filter').val();
			searchData.timeFilter = form.find('#post-time-filter').val();
			searchData.timeRange = form.find('#post-time-range').val();
			searchData.sortBy = form.find('#post-sort-by').val();
			searchData.sortDirection = form.find('#post-sort-direction').val();
			searchData.showAs = form.find('#show-as-topics').is(':checked') ? 'topics' : 'posts';
		}

		$(window).trigger('action:search.getSearchDataFromDOM', {
			form: form,
			data: searchData,
		});

		return searchData;
	}

	function updateFormItemVisiblity(searchIn) {
		var hide = searchIn.indexOf('posts') === -1 && searchIn.indexOf('titles') === -1;
		$('.post-search-item').toggleClass('hide', hide);
	}

	function fillOutForm() {
		var params = utils.params();

		var searchData = searchModule.getSearchPreferences();
		var formData = utils.merge(searchData, params);

		if (formData) {
			if (ajaxify.data.term) {
				$('#search-input').val(ajaxify.data.term);
			}

			if (formData.in) {
				$('#search-in').val(formData.in);
				updateFormItemVisiblity(formData.in);
			}

			if (formData.by) {
				$('#posted-by-user').val(formData.by);
			}

			if (formData.categories) {
				$('#posted-in-categories').val(formData.categories);
			}

			if (formData.searchChildren) {
				$('#search-children').prop('checked', true);
			}

			if (formData.hasTags) {
				formData.hasTags = Array.isArray(formData.hasTags) ? formData.hasTags : [formData.hasTags];
				formData.hasTags.forEach(function (tag) {
					$('#has-tags').tagsinput('add', tag);
				});
			}

			if (formData.replies) {
				$('#reply-count').val(formData.replies);
				$('#reply-count-filter').val(formData.repliesFilter);
			}

			if (formData.timeRange) {
				$('#post-time-range').val(formData.timeRange);
				$('#post-time-filter').val(formData.timeFilter);
			}

			if (formData.sortBy || ajaxify.data.searchDefaultSortBy) {
				$('#post-sort-by').val(formData.sortBy || ajaxify.data.searchDefaultSortBy);
				$('#post-sort-direction').val(formData.sortDirection);
			}

			if (formData.showAs) {
				var isTopic = formData.showAs === 'topics';
				var isPost = formData.showAs === 'posts';
				$('#show-as-topics').prop('checked', isTopic).parent().toggleClass('active', isTopic);
				$('#show-as-posts').prop('checked', isPost).parent().toggleClass('active', isPost);
			}

			$(window).trigger('action:search.fillOutForm', {
				form: formData,
			});
		}
	}

	function highlightMatches(searchQuery) {
		if (!searchQuery) {
			return;
		}

		var regexStr = searchQuery.replace(/^"/, '').replace(/"$/, '').trim().split(' ').join('|');
		var regex = new RegExp('(' + regexStr + ')', 'gi');

		$('.search-result-text p, .search-result-text h4').each(function () {
			var result = $(this);
			var nested = [];

			result.find('*').each(function () {
				$(this).after('<!-- ' + nested.length + ' -->');
				nested.push($('<div />').append($(this)));
			});

			result.html(result.html().replace(regex, '<strong>$1</strong>'));

			for (var i = 0, ii = nested.length; i < ii; i += 1) {
				result.html(result.html().replace('<!-- ' + i + ' -->', nested[i].html()));
			}
		});

		$('.search-result-text').find('img:not(.not-responsive)').addClass('img-responsive');
	}

	function handleSavePreferences() {
		$('#save-preferences').on('click', function () {
			storage.setItem('search-preferences', JSON.stringify(getSearchDataFromDOM()));
			app.alertSuccess('[[search:search-preferences-saved]]');
			return false;
		});

		$('#clear-preferences').on('click', function () {
			storage.removeItem('search-preferences');
			var query = $('#search-input').val();
			$('#advanced-search')[0].reset();
			$('#search-input').val(query);
			app.alertSuccess('[[search:search-preferences-cleared]]');
			return false;
		});
	}

	function enableAutoComplete() {
		autocomplete.user($('#posted-by-user'));

		var tagEl = $('#has-tags');
		tagEl.tagsinput({
			confirmKeys: [13, 44],
			trimValue: true,
		});

		autocomplete.tag($('#has-tags').siblings('.bootstrap-tagsinput').find('input'));
	}

	return Search;
});
