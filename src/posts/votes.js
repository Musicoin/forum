'use strict';

var async = require('async');

var meta = require('../meta');
var db = require('../database');
var user = require('../user');
var plugins = require('../plugins');

module.exports = function (Posts) {
	var votesInProgress = {};

	Posts.upvote = function (pid, uid, callback) {
		if (parseInt(meta.config['reputation:disabled'], 10) === 1) {
			return callback(new Error('[[error:reputation-system-disabled]]'));
		}

		if (voteInProgress(pid, uid)) {
			return callback(new Error('[[error:already-voting-for-this-post]]'));
		}

		putVoteInProgress(pid, uid);

		toggleVote('upvote', pid, uid, function (err, data) {
			clearVoteProgress(pid, uid);
			callback(err, data);
		});
	};

	Posts.downvote = function (pid, uid, callback) {
		if (parseInt(meta.config['reputation:disabled'], 10) === 1) {
			return callback(new Error('[[error:reputation-system-disabled]]'));
		}

		if (parseInt(meta.config['downvote:disabled'], 10) === 1) {
			return callback(new Error('[[error:downvoting-disabled]]'));
		}

		if (voteInProgress(pid, uid)) {
			return callback(new Error('[[error:already-voting-for-this-post]]'));
		}

		putVoteInProgress(pid, uid);

		toggleVote('downvote', pid, uid, function (err, data) {
			clearVoteProgress(pid, uid);
			callback(err, data);
		});
	};

	Posts.unvote = function (pid, uid, callback) {
		if (voteInProgress(pid, uid)) {
			return callback(new Error('[[error:already-voting-for-this-post]]'));
		}

		putVoteInProgress(pid, uid);

		unvote(pid, uid, 'unvote', function (err, data) {
			clearVoteProgress(pid, uid);
			callback(err, data);
		});
	};

	Posts.hasVoted = function (pid, uid, callback) {
		if (!parseInt(uid, 10)) {
			return callback(null, { upvoted: false, downvoted: false });
		}
		async.waterfall([
			function (next) {
				db.isMemberOfSets(['pid:' + pid + ':upvote', 'pid:' + pid + ':downvote'], uid, next);
			},
			function (hasVoted, next) {
				next(null, { upvoted: hasVoted[0], downvoted: hasVoted[1] });
			},
		], callback);
	};

	Posts.getVoteStatusByPostIDs = function (pids, uid, callback) {
		if (!parseInt(uid, 10)) {
			var data = pids.map(function () { return false; });
			return callback(null, { upvotes: data, downvotes: data });
		}
		var upvoteSets = [];
		var downvoteSets = [];

		for (var i = 0; i < pids.length; i += 1) {
			upvoteSets.push('pid:' + pids[i] + ':upvote');
			downvoteSets.push('pid:' + pids[i] + ':downvote');
		}

		async.parallel({
			upvotes: function (next) {
				db.isMemberOfSets(upvoteSets, uid, next);
			},
			downvotes: function (next) {
				db.isMemberOfSets(downvoteSets, uid, next);
			},
		}, callback);
	};

	Posts.getUpvotedUidsByPids = function (pids, callback) {
		var sets = pids.map(function (pid) {
			return 'pid:' + pid + ':upvote';
		});
		db.getSetsMembers(sets, callback);
	};

	function voteInProgress(pid, uid) {
		return Array.isArray(votesInProgress[uid]) && votesInProgress[uid].indexOf(parseInt(pid, 10)) !== -1;
	}

	function putVoteInProgress(pid, uid) {
		votesInProgress[uid] = votesInProgress[uid] || [];
		votesInProgress[uid].push(parseInt(pid, 10));
	}

	function clearVoteProgress(pid, uid) {
		if (Array.isArray(votesInProgress[uid])) {
			var index = votesInProgress[uid].indexOf(parseInt(pid, 10));
			if (index !== -1) {
				votesInProgress[uid].splice(index, 1);
			}
		}
	}

	function toggleVote(type, pid, uid, callback) {
		async.waterfall([
			function (next) {
				unvote(pid, uid, type, function (err) {
					next(err);
				});
			},
			function (next) {
				vote(type, false, pid, uid, next);
			},
		], callback);
	}

	function unvote(pid, uid, command, callback) {
		async.waterfall([
			function (next) {
				async.parallel({
					owner: function (next) {
						Posts.getPostField(pid, 'uid', next);
					},
					voteStatus: function (next) {
						Posts.hasVoted(pid, uid, next);
					},
					reputation: function (next) {
						user.getUserField(uid, 'reputation', next);
					},
				}, next);
			},
			function (results, next) {
				if (parseInt(uid, 10) === parseInt(results.owner, 10)) {
					return callback(new Error('[[error:self-vote]]'));
				}

				if (command === 'downvote' && parseInt(results.reputation, 10) < parseInt(meta.config['privileges:downvote'], 10)) {
					return callback(new Error('[[error:not-enough-reputation-to-downvote]]'));
				}

				var voteStatus = results.voteStatus;
				var hook;
				var current = voteStatus.upvoted ? 'upvote' : 'downvote';

				if ((voteStatus.upvoted && command === 'downvote') || (voteStatus.downvoted && command === 'upvote')) {	// e.g. User *has* upvoted, and clicks downvote
					hook = command;
				} else if (voteStatus.upvoted || voteStatus.downvoted) {	// e.g. User *has* upvoted, clicks upvote (so we "unvote")
					hook = 'unvote';
				} else {	// e.g. User *has not* voted, clicks upvote
					hook = command;
					current = 'unvote';
				}

				plugins.fireHook('action:post.' + hook, {
					pid: pid,
					uid: uid,
					owner: results.owner,
					current: current,
				});

				if (!voteStatus || (!voteStatus.upvoted && !voteStatus.downvoted)) {
					return callback();
				}

				vote(voteStatus.upvoted ? 'downvote' : 'upvote', true, pid, uid, next);
			},
		], callback);
	}

	function vote(type, unvote, pid, uid, callback) {
		uid = parseInt(uid, 10);

		if (!uid) {
			return callback(new Error('[[error:not-logged-in]]'));
		}
		var postData;
		var newreputation;
		async.waterfall([
			function (next) {
				Posts.getPostFields(pid, ['pid', 'uid', 'tid'], next);
			},
			function (_postData, next) {
				postData = _postData;
				var now = Date.now();

				if (type === 'upvote' && !unvote) {
					db.sortedSetAdd('uid:' + uid + ':upvote', now, pid);
				} else {
					db.sortedSetRemove('uid:' + uid + ':upvote', pid);
				}

				if (type === 'upvote' || unvote) {
					db.sortedSetRemove('uid:' + uid + ':downvote', pid);
				} else {
					db.sortedSetAdd('uid:' + uid + ':downvote', now, pid);
				}

				user[type === 'upvote' ? 'incrementUserFieldBy' : 'decrementUserFieldBy'](postData.uid, 'reputation', 1, next);
			},
			function (_newreputation, next) {
				newreputation = _newreputation;
				if (parseInt(postData.uid, 10)) {
					db.sortedSetAdd('users:reputation', newreputation, postData.uid);
				}

				adjustPostVotes(postData, uid, type, unvote, next);
			},
			function (next) {
				next(null, {
					user: {
						reputation: newreputation,
					},
					fromuid: uid,
					post: postData,
					upvote: type === 'upvote' && !unvote,
					downvote: type === 'downvote' && !unvote,
				});
			},
		], callback);
	}

	function adjustPostVotes(postData, uid, type, unvote, callback) {
		var notType = (type === 'upvote' ? 'downvote' : 'upvote');
		async.waterfall([
			function (next) {
				async.series([
					function (next) {
						if (unvote) {
							db.setRemove('pid:' + postData.pid + ':' + type, uid, next);
						} else {
							db.setAdd('pid:' + postData.pid + ':' + type, uid, next);
						}
					},
					function (next) {
						db.setRemove('pid:' + postData.pid + ':' + notType, uid, next);
					},
				], function (err) {
					next(err);
				});
			},
			function (next) {
				async.parallel({
					upvotes: function (next) {
						db.setCount('pid:' + postData.pid + ':upvote', next);
					},
					downvotes: function (next) {
						db.setCount('pid:' + postData.pid + ':downvote', next);
					},
				}, next);
			},
			function (results, next) {
				postData.upvotes = parseInt(results.upvotes, 10);
				postData.downvotes = parseInt(results.downvotes, 10);
				postData.votes = postData.upvotes - postData.downvotes;
				Posts.updatePostVoteCount(postData, next);
			},
		], callback);
	}
};
