'use strict';

var async = require('async');
var assert = require('assert');
var validator = require('validator');
var nconf = require('nconf');

var db = require('./mocks/databasemock');
var topics = require('../src/topics');
var posts = require('../src/posts');
var categories = require('../src/categories');
var privileges = require('../src/privileges');
var meta = require('../src/meta');
var User = require('../src/user');
var groups = require('../src/groups');
var helpers = require('./helpers');
var socketPosts = require('../src/socket.io/posts');
var socketTopics = require('../src/socket.io/topics');

describe('Topic\'s', function () {
	var topic;
	var categoryObj;
	var adminUid;

	before(function (done) {
		groups.resetCache();
		User.create({ username: 'admin', password: '123456' }, function (err, uid) {
			if (err) {
				return done(err);
			}

			adminUid = uid;

			categories.create({
				name: 'Test Category',
				description: 'Test category created by testing script',
			}, function (err, category) {
				if (err) {
					return done(err);
				}

				categoryObj = category;

				topic = {
					userId: uid,
					categoryId: categoryObj.cid,
					title: 'Test Topic Title',
					content: 'The content of test topic',
				};
				done();
			});
		});
	});

	describe('.post', function () {
		it('should fail to create topic with invalid data', function (done) {
			socketTopics.post({ uid: 0 }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should create a new topic with proper parameters', function (done) {
			topics.post({ uid: topic.userId, title: topic.title, content: topic.content, cid: topic.categoryId }, function (err, result) {
				assert.ifError(err);
				assert(result);
				topic.tid = result.topicData.tid;
				done();
			});
		});

		it('should get post count', function (done) {
			socketTopics.postcount({ uid: adminUid }, topic.tid, function (err, count) {
				assert.ifError(err);
				assert.equal(count, 1);
				done();
			});
		});

		it('should load topic', function (done) {
			socketTopics.getTopic({ uid: adminUid }, topic.tid, function (err, data) {
				assert.ifError(err);
				assert.equal(data.tid, topic.tid);
				done();
			});
		});

		it('should fail to create new topic with invalid user id', function (done) {
			topics.post({ uid: null, title: topic.title, content: topic.content, cid: topic.categoryId }, function (err) {
				assert.equal(err.message, '[[error:no-privileges]]');
				done();
			});
		});

		it('should fail to create new topic with empty title', function (done) {
			topics.post({ uid: topic.userId, title: '', content: topic.content, cid: topic.categoryId }, function (err) {
				assert.ok(err);
				done();
			});
		});

		it('should fail to create new topic with empty content', function (done) {
			topics.post({ uid: topic.userId, title: topic.title, content: '', cid: topic.categoryId }, function (err) {
				assert.ok(err);
				done();
			});
		});

		it('should fail to create new topic with non-existant category id', function (done) {
			topics.post({ uid: topic.userId, title: topic.title, content: topic.content, cid: 99 }, function (err) {
				assert.equal(err.message, '[[error:no-category]]', 'received no error');
				done();
			});
		});

		it('should return false for falsy uid', function (done) {
			topics.isOwner(topic.tid, 0, function (err, isOwner) {
				assert.ifError(err);
				assert(!isOwner);
				done();
			});
		});
	});

	describe('.reply', function () {
		var newTopic;
		var newPost;

		before(function (done) {
			topics.post({ uid: topic.userId, title: topic.title, content: topic.content, cid: topic.categoryId }, function (err, result) {
				if (err) {
					return done(err);
				}

				newTopic = result.topicData;
				newPost = result.postData;
				done();
			});
		});

		it('should create a new reply with proper parameters', function (done) {
			topics.reply({ uid: topic.userId, content: 'test post', tid: newTopic.tid }, function (err, result) {
				assert.equal(err, null, 'was created with error');
				assert.ok(result);

				done();
			});
		});

		it('should handle direct replies', function (done) {
			topics.reply({ uid: topic.userId, content: 'test reply', tid: newTopic.tid, toPid: newPost.pid }, function (err, result) {
				assert.equal(err, null, 'was created with error');
				assert.ok(result);

				socketPosts.getReplies({ uid: 0 }, newPost.pid, function (err, postData) {
					assert.equal(err, null, 'posts.getReplies returned error');

					assert.ok(postData);

					assert.equal(postData.length, 1, 'should have 1 result');
					assert.equal(postData[0].pid, result.pid, 'result should be the reply we added');

					done();
				});
			});
		});

		it('should error if pid is not a number', function (done) {
			socketPosts.getReplies({ uid: 0 }, 'abc', function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should fail to create new reply with invalid user id', function (done) {
			topics.reply({ uid: null, content: 'test post', tid: newTopic.tid }, function (err) {
				assert.equal(err.message, '[[error:no-privileges]]');
				done();
			});
		});

		it('should fail to create new reply with empty content', function (done) {
			topics.reply({ uid: topic.userId, content: '', tid: newTopic.tid }, function (err) {
				assert.ok(err);
				done();
			});
		});

		it('should fail to create new reply with invalid topic id', function (done) {
			topics.reply({ uid: null, content: 'test post', tid: 99 }, function (err) {
				assert.equal(err.message, '[[error:no-topic]]');
				done();
			});
		});

		it('should fail to create new reply with invalid toPid', function (done) {
			topics.reply({ uid: topic.userId, content: 'test post', tid: newTopic.tid, toPid: '"onmouseover=alert(1);//' }, function (err) {
				assert.equal(err.message, '[[error:invalid-pid]]');
				done();
			});
		});
	});

	describe('Get methods', function () {
		var	newTopic;
		var newPost;

		before(function (done) {
			topics.post({ uid: topic.userId, title: topic.title, content: topic.content, cid: topic.categoryId }, function (err, result) {
				if (err) {
					return done(err);
				}

				newTopic = result.topicData;
				newPost = result.postData;
				done();
			});
		});


		it('should not receive errors', function (done) {
			topics.getTopicData(newTopic.tid, done);
		});

		it('should get topic title by pid', function (done) {
			topics.getTitleByPid(newPost.pid, function (err, title) {
				assert.ifError(err);
				assert.equal(title, topic.title);
				done();
			});
		});

		it('should get topic data by pid', function (done) {
			topics.getTopicDataByPid(newPost.pid, function (err, data) {
				assert.ifError(err);
				assert.equal(data.tid, newTopic.tid);
				done();
			});
		});

		describe('.getTopicWithPosts', function () {
			it('should get a topic with posts and other data', function (done) {
				topics.getTopicData(newTopic.tid, function (err, topicData) {
					if (err) {
						return done(err);
					}
					topics.getTopicWithPosts(topicData, 'tid:' + newTopic.tid + ':posts', topic.userId, 0, -1, false, function (err, data) {
						if (err) {
							return done(err);
						}
						assert(data);
						assert.equal(data.category.cid, topic.categoryId);
						assert.equal(data.unreplied, true);
						assert.equal(data.deleted, false);
						assert.equal(data.locked, false);
						assert.equal(data.pinned, false);
						done();
					});
				});
			});
		});
	});

	describe('Title escaping', function () {
		it('should properly escape topic title', function (done) {
			var title = '"<script>alert(\'ok1\');</script> new topic test';
			var titleEscaped = validator.escape(title);
			topics.post({ uid: topic.userId, title: title, content: topic.content, cid: topic.categoryId }, function (err, result) {
				assert.ifError(err);
				topics.getTopicData(result.topicData.tid, function (err, topicData) {
					assert.ifError(err);
					assert.strictEqual(topicData.titleRaw, title);
					assert.strictEqual(topicData.title, titleEscaped);
					done();
				});
			});
		});
	});

	describe('tools/delete/restore/purge', function () {
		var newTopic;
		var followerUid;
		var moveCid;

		before(function (done) {
			async.waterfall([
				function (next) {
					groups.join('administrators', adminUid, next);
				},
				function (next) {
					topics.post({ uid: topic.userId, title: topic.title, content: topic.content, cid: topic.categoryId }, function (err, result) {
						assert.ifError(err);
						newTopic = result.topicData;
						next();
					});
				},
				function (next) {
					User.create({ username: 'topicFollower', password: '123456' }, next);
				},
				function (_uid, next) {
					followerUid = _uid;
					topics.follow(newTopic.tid, _uid, next);
				},
				function (next) {
					categories.create({
						name: 'Test Category',
						description: 'Test category created by testing script',
					}, function (err, category) {
						if (err) {
							return next(err);
						}
						moveCid = category.cid;
						next();
					});
				},
			], done);
		});

		it('should load topic tools', function (done) {
			socketTopics.loadTopicTools({ uid: 1 }, { tid: newTopic.tid }, function (err, data) {
				assert.ifError(err);
				assert(data);
				done();
			});
		});

		it('should delete the topic', function (done) {
			socketTopics.delete({ uid: 1 }, { tids: [newTopic.tid], cid: categoryObj.cid }, function (err) {
				assert.ifError(err);
				done();
			});
		});

		it('should restore the topic', function (done) {
			socketTopics.restore({ uid: 1 }, { tids: [newTopic.tid], cid: categoryObj.cid }, function (err) {
				assert.ifError(err);
				done();
			});
		});

		it('should lock topic', function (done) {
			socketTopics.lock({ uid: 1 }, { tids: [newTopic.tid], cid: categoryObj.cid }, function (err) {
				assert.ifError(err);
				topics.isLocked(newTopic.tid, function (err, isLocked) {
					assert.ifError(err);
					assert(isLocked);
					done();
				});
			});
		});

		it('should unlock topic', function (done) {
			socketTopics.unlock({ uid: 1 }, { tids: [newTopic.tid], cid: categoryObj.cid }, function (err) {
				assert.ifError(err);
				topics.isLocked(newTopic.tid, function (err, isLocked) {
					assert.ifError(err);
					assert(!isLocked);
					done();
				});
			});
		});

		it('should pin topic', function (done) {
			socketTopics.pin({ uid: 1 }, { tids: [newTopic.tid], cid: categoryObj.cid }, function (err) {
				assert.ifError(err);
				db.getObjectField('topic:' + newTopic.tid, 'pinned', function (err, pinned) {
					assert.ifError(err);
					assert.strictEqual(parseInt(pinned, 10), 1);
					done();
				});
			});
		});

		it('should unpin topic', function (done) {
			socketTopics.unpin({ uid: 1 }, { tids: [newTopic.tid], cid: categoryObj.cid }, function (err) {
				assert.ifError(err);
				db.getObjectField('topic:' + newTopic.tid, 'pinned', function (err, pinned) {
					assert.ifError(err);
					assert.strictEqual(parseInt(pinned, 10), 0);
					done();
				});
			});
		});

		it('should move all topics', function (done) {
			socketTopics.moveAll({ uid: 1 }, { cid: moveCid, currentCid: categoryObj.cid }, function (err) {
				assert.ifError(err);
				topics.getTopicField(newTopic.tid, 'cid', function (err, cid) {
					assert.ifError(err);
					assert.equal(cid, moveCid);
					done();
				});
			});
		});

		it('should move a topic', function (done) {
			socketTopics.move({ uid: 1 }, { cid: categoryObj.cid, tids: [newTopic.tid] }, function (err) {
				assert.ifError(err);
				topics.getTopicField(newTopic.tid, 'cid', function (err, cid) {
					assert.ifError(err);
					assert.equal(cid, categoryObj.cid);
					done();
				});
			});
		});

		it('should purge the topic', function (done) {
			socketTopics.purge({ uid: 1 }, { tids: [newTopic.tid], cid: categoryObj.cid }, function (err) {
				assert.ifError(err);
				db.isSortedSetMember('uid:' + followerUid + ':followed_tids', newTopic.tid, function (err, isMember) {
					assert.ifError(err);
					assert.strictEqual(false, isMember);
					done();
				});
			});
		});
	});

	describe('order pinned topics', function () {
		var tid1;
		var tid2;
		var tid3;
		before(function (done) {
			function createTopic(callback) {
				topics.post({
					uid: topic.userId,
					title: 'topic for test',
					content: 'topic content',
					cid: topic.categoryId,
				}, callback);
			}
			async.series({
				topic1: function (next) {
					createTopic(next);
				},
				topic2: function (next) {
					createTopic(next);
				},
				topic3: function (next) {
					createTopic(next);
				},
			}, function (err, results) {
				assert.ifError(err);
				tid1 = results.topic1.topicData.tid;
				tid2 = results.topic2.topicData.tid;
				tid3 = results.topic3.topicData.tid;
				async.series([
					function (next) {
						topics.tools.pin(tid1, adminUid, next);
					},
					function (next) {
						topics.tools.pin(tid2, adminUid, next);
					},
				], done);
			});
		});

		var socketTopics = require('../src/socket.io/topics');
		it('should error with invalid data', function (done) {
			socketTopics.orderPinnedTopics({ uid: adminUid }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should error with invalid data', function (done) {
			socketTopics.orderPinnedTopics({ uid: adminUid }, [null, null], function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should error with unprivileged user', function (done) {
			socketTopics.orderPinnedTopics({ uid: 0 }, [{ tid: tid1 }, { tid: tid2 }], function (err) {
				assert.equal(err.message, '[[error:no-privileges]]');
				done();
			});
		});

		it('should not do anything if topics are not pinned', function (done) {
			socketTopics.orderPinnedTopics({ uid: adminUid }, [{ tid: tid3 }], function (err) {
				assert.ifError(err);
				db.isSortedSetMember('cid:' + topic.categoryId + ':tids:pinned', tid3, function (err, isMember) {
					assert.ifError(err);
					assert(!isMember);
					done();
				});
			});
		});

		it('should order pinned topics', function (done) {
			db.getSortedSetRevRange('cid:' + topic.categoryId + ':tids:pinned', 0, -1, function (err, pinnedTids) {
				assert.ifError(err);
				assert.equal(pinnedTids[0], tid2);
				assert.equal(pinnedTids[1], tid1);
				socketTopics.orderPinnedTopics({ uid: adminUid }, [{ tid: tid1, order: 1 }, { tid: tid2, order: 0 }], function (err) {
					assert.ifError(err);
					db.getSortedSetRevRange('cid:' + topic.categoryId + ':tids:pinned', 0, -1, function (err, pinnedTids) {
						assert.ifError(err);
						assert.equal(pinnedTids[0], tid1);
						assert.equal(pinnedTids[1], tid2);
						done();
					});
				});
			});
		});
	});


	describe('.ignore', function () {
		var newTid;
		var uid;
		var newTopic;
		before(function (done) {
			uid = topic.userId;
			async.waterfall([
				function (done) {
					topics.post({ uid: topic.userId, title: 'Topic to be ignored', content: 'Just ignore me, please!', cid: topic.categoryId }, function (err, result) {
						if (err) {
							return done(err);
						}

						newTopic = result.topicData;
						newTid = newTopic.tid;
						done();
					});
				},
				function (done) {
					topics.markUnread(newTid, uid, done);
				},
			], done);
		});

		it('should not appear in the unread list', function (done) {
			async.waterfall([
				function (done) {
					topics.ignore(newTid, uid, done);
				},
				function (done) {
					topics.getUnreadTopics({ cid: 0, uid: uid, start: 0, stop: -1, filter: '' }, done);
				},
				function (results, done) {
					var topics = results.topics;
					var tids = topics.map(function (topic) { return topic.tid; });
					assert.equal(tids.indexOf(newTid), -1, 'The topic appeared in the unread list.');
					done();
				},
			], done);
		});

		it('should not appear as unread in the recent list', function (done) {
			async.waterfall([
				function (done) {
					topics.ignore(newTid, uid, done);
				},
				function (done) {
					topics.getLatestTopics(uid, 0, -1, 'year', done);
				},
				function (results, done) {
					var topics = results.topics;
					var topic;
					var i;
					for (i = 0; i < topics.length; i += 1) {
						if (parseInt(topics[i].tid, 10) === parseInt(newTid, 10)) {
							assert.equal(false, topics[i].unread, 'ignored topic was marked as unread in recent list');
							return done();
						}
					}
					assert.ok(topic, 'topic didn\'t appear in the recent list');
					done();
				},
			], done);
		});

		it('should appear as unread again when marked as reading', function (done) {
			async.waterfall([
				function (done) {
					topics.ignore(newTid, uid, done);
				},
				function (done) {
					topics.follow(newTid, uid, done);
				},
				function (done) {
					topics.getUnreadTopics({ cid: 0, uid: uid, start: 0, stop: -1, filter: '' }, done);
				},
				function (results, done) {
					var topics = results.topics;
					var tids = topics.map(function (topic) { return topic.tid; });
					assert.notEqual(tids.indexOf(newTid), -1, 'The topic did not appear in the unread list.');
					done();
				},
			], done);
		});

		it('should appear as unread again when marked as following', function (done) {
			async.waterfall([
				function (done) {
					topics.ignore(newTid, uid, done);
				},
				function (done) {
					topics.follow(newTid, uid, done);
				},
				function (done) {
					topics.getUnreadTopics({ cid: 0, uid: uid, start: 0, stop: -1, filter: '' }, done);
				},
				function (results, done) {
					var topics = results.topics;
					var tids = topics.map(function (topic) { return topic.tid; });
					assert.notEqual(tids.indexOf(newTid), -1, 'The topic did not appear in the unread list.');
					done();
				},
			], done);
		});
	});

	describe('.fork', function () {
		var newTopic;
		var replies = [];
		var topicPids;
		var originalBookmark = 5;
		function postReply(next) {
			topics.reply({ uid: topic.userId, content: 'test post ' + replies.length, tid: newTopic.tid }, function (err, result) {
				assert.equal(err, null, 'was created with error');
				assert.ok(result);
				replies.push(result);
				next();
			});
		}

		before(function (done) {
			async.waterfall([
				function (next) {
					groups.join('administrators', topic.userId, next);
				},
				function (next) {
					topics.post({ uid: topic.userId, title: topic.title, content: topic.content, cid: topic.categoryId }, function (err, result) {
						assert.ifError(err);
						newTopic = result.topicData;
						next();
					});
				},
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) { postReply(next); },
				function (next) {
					topicPids = replies.map(function (reply) { return reply.pid; });
					socketTopics.bookmark({ uid: topic.userId }, { tid: newTopic.tid, index: originalBookmark }, next);
				},
			], done);
		});

		it('should fail with invalid data', function (done) {
			socketTopics.bookmark({ uid: topic.userId }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should have 12 replies', function (done) {
			assert.equal(12, replies.length);
			done();
		});

		it('should fail with invalid data', function (done) {
			socketTopics.createTopicFromPosts({ uid: 0 }, null, function (err) {
				assert.equal(err.message, '[[error:not-logged-in]]');
				done();
			});
		});

		it('should fail with invalid data', function (done) {
			socketTopics.createTopicFromPosts({ uid: 1 }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should not update the user\'s bookmark', function (done) {
			async.waterfall([
				function (next) {
					socketTopics.createTopicFromPosts({ uid: topic.userId }, {
						title: 'Fork test, no bookmark update',
						pids: topicPids.slice(-2),
						fromTid: newTopic.tid,
					}, next);
				},
				function (forkedTopicData, next) {
					topics.getUserBookmark(newTopic.tid, topic.userId, next);
				},
				function (bookmark, next) {
					assert.equal(originalBookmark, bookmark);
					next();
				},
			], done);
		});

		it('should update the user\'s bookmark ', function (done) {
			async.waterfall([
				function (next) {
					topics.createTopicFromPosts(
						topic.userId,
						'Fork test, no bookmark update',
						topicPids.slice(1, 3),
						newTopic.tid,
						next
					);
				},
				function (forkedTopicData, next) {
					topics.getUserBookmark(newTopic.tid, topic.userId, next);
				},
				function (bookmark, next) {
					assert.equal(originalBookmark - 2, bookmark);
					next();
				},
			], done);
		});
	});

	describe('controller', function () {
		var request = require('request');
		var topicData;

		before(function (done) {
			topics.post({
				uid: topic.userId,
				title: 'topic for controller test',
				content: 'topic content',
				cid: topic.categoryId,
				thumb: 'http://i.imgur.com/64iBdBD.jpg',
			}, function (err, result) {
				assert.ifError(err);
				assert.ok(result);
				topicData = result.topicData;
				done();
			});
		});

		it('should load topic', function (done) {
			request(nconf.get('url') + '/topic/' + topicData.slug, function (err, response, body) {
				assert.ifError(err);
				assert.equal(response.statusCode, 200);
				assert(body);
				done();
			});
		});

		it('should 404 if post index is invalid', function (done) {
			request(nconf.get('url') + '/topic/' + topicData.slug + '/derp', function (err, response) {
				assert.ifError(err);
				assert.equal(response.statusCode, 404);
				done();
			});
		});

		it('should 404 if topic does not exist', function (done) {
			request(nconf.get('url') + '/topic/123123/does-not-exist', function (err, response) {
				assert.ifError(err);
				assert.equal(response.statusCode, 404);
				done();
			});
		});

		it('should 401 if not allowed to read as guest', function (done) {
			var privileges = require('../src/privileges');
			privileges.categories.rescind(['topics:read'], topicData.cid, 'guests', function (err) {
				assert.ifError(err);
				request(nconf.get('url') + '/api/topic/' + topicData.slug, function (err, response, body) {
					assert.ifError(err);
					assert.equal(response.statusCode, 401);
					assert(body);
					privileges.categories.give(['topics:read'], topicData.cid, 'guests', done);
				});
			});
		});

		it('should redirect to correct topic if slug is missing', function (done) {
			request(nconf.get('url') + '/topic/' + topicData.tid + '/herpderp/1?page=2', function (err, response, body) {
				assert.ifError(err);
				assert.equal(response.statusCode, 200);
				assert(body);
				done();
			});
		});

		it('should redirect if post index is out of range', function (done) {
			request(nconf.get('url') + '/api/topic/' + topicData.slug + '/-1', { json: true }, function (err, res, body) {
				assert.ifError(err);
				assert.equal(res.statusCode, 200);
				assert.equal(res.headers['x-redirect'], '/topic/13/topic-for-controller-test');
				assert.equal(body, '/topic/13/topic-for-controller-test');
				done();
			});
		});

		it('should 404 if page is out of bounds', function (done) {
			var meta = require('../src/meta');
			meta.config.usePagination = 1;
			request(nconf.get('url') + '/topic/' + topicData.slug + '?page=100', function (err, response) {
				assert.ifError(err);
				assert.equal(response.statusCode, 404);
				done();
			});
		});

		it('should mark topic read', function (done) {
			helpers.loginUser('admin', '123456', function (err, jar) {
				assert.ifError(err);
				request(nconf.get('url') + '/topic/' + topicData.slug, {
					jar: jar,
				}, function (err, res) {
					assert.ifError(err);
					assert.equal(res.statusCode, 200);
					topics.hasReadTopics([topicData.tid], adminUid, function (err, hasRead) {
						assert.ifError(err);
						assert.equal(hasRead[0], true);
						done();
					});
				});
			});
		});

		it('should 404 if tid is not a number', function (done) {
			request(nconf.get('url') + '/api/topic/teaser/nan', { json: true }, function (err, response) {
				assert.ifError(err);
				assert.equal(response.statusCode, 404);
				done();
			});
		});

		it('should 403 if cant read', function (done) {
			request(nconf.get('url') + '/api/topic/teaser/' + 123123, { json: true }, function (err, response, body) {
				assert.ifError(err);
				assert.equal(response.statusCode, 403);
				assert.equal(body, '[[error:no-privileges]]');

				done();
			});
		});

		it('should load topic teaser', function (done) {
			request(nconf.get('url') + '/api/topic/teaser/' + topicData.tid, { json: true }, function (err, response, body) {
				assert.ifError(err);
				assert.equal(response.statusCode, 200);
				assert(body);
				assert.equal(body.tid, topicData.tid);
				assert.equal(body.content, 'topic content');
				assert(body.user);
				assert(body.topic);
				assert(body.category);
				done();
			});
		});


		it('should 404 if tid is not a number', function (done) {
			request(nconf.get('url') + '/api/topic/pagination/nan', { json: true }, function (err, response) {
				assert.ifError(err);
				assert.equal(response.statusCode, 404);
				done();
			});
		});

		it('should 404 if tid does not exist', function (done) {
			request(nconf.get('url') + '/api/topic/pagination/1231231', { json: true }, function (err, response) {
				assert.ifError(err);
				assert.equal(response.statusCode, 404);
				done();
			});
		});

		it('should load pagination', function (done) {
			request(nconf.get('url') + '/api/topic/pagination/' + topicData.tid, { json: true }, function (err, response, body) {
				assert.ifError(err);
				assert.equal(response.statusCode, 200);
				assert(body);
				assert.deepEqual(body, {
					prev: { page: 1, active: false },
					next: { page: 1, active: false },
					rel: [],
					pages: [],
					currentPage: 1,
					pageCount: 1,
				});
				done();
			});
		});
	});


	describe('infinitescroll', function () {
		var socketTopics = require('../src/socket.io/topics');
		var tid;
		before(function (done) {
			topics.post({ uid: topic.userId, title: topic.title, content: topic.content, cid: topic.categoryId }, function (err, result) {
				assert.ifError(err);
				tid = result.topicData.tid;
				done();
			});
		});

		it('should error with invalid data', function (done) {
			socketTopics.loadMore({ uid: adminUid }, {}, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should infinite load topic posts', function (done) {
			socketTopics.loadMore({ uid: adminUid }, { tid: tid, after: 0, count: 10 }, function (err, data) {
				assert.ifError(err);
				assert(data.mainPost);
				assert(data.posts);
				assert(data.privileges);
				done();
			});
		});

		it('should error with invalid data', function (done) {
			socketTopics.loadMoreUnreadTopics({ uid: adminUid }, { after: 'invalid' }, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should load more unread topics', function (done) {
			socketTopics.markUnread({ uid: adminUid }, tid, function (err) {
				assert.ifError(err);
				socketTopics.loadMoreUnreadTopics({ uid: adminUid }, { cid: topic.categoryId, after: 0, count: 10 }, function (err, data) {
					assert.ifError(err);
					assert(data);
					assert(Array.isArray(data.topics));
					done();
				});
			});
		});

		it('should error with invalid data', function (done) {
			socketTopics.loadMoreRecentTopics({ uid: adminUid }, { after: 'invalid' }, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});


		it('should load more recent topics', function (done) {
			socketTopics.loadMoreRecentTopics({ uid: adminUid }, { cid: topic.categoryId, after: 0, count: 10 }, function (err, data) {
				assert.ifError(err);
				assert(data);
				assert(Array.isArray(data.topics));
				done();
			});
		});

		it('should error with invalid data', function (done) {
			socketTopics.loadMoreFromSet({ uid: adminUid }, { after: 'invalid' }, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should load more from custom set', function (done) {
			socketTopics.loadMoreFromSet({ uid: adminUid }, { set: 'uid:' + adminUid + ':topics', after: 0, count: 10 }, function (err, data) {
				assert.ifError(err);
				assert(data);
				assert(Array.isArray(data.topics));
				done();
			});
		});
	});

	describe('suggested topics', function () {
		var tid1;
		var tid2;
		before(function (done) {
			async.parallel({
				topic1: function (next) {
					topics.post({ uid: adminUid, tags: ['nodebb'], title: 'topic title 1', content: 'topic 1 content', cid: topic.categoryId }, next);
				},
				topic2: function (next) {
					topics.post({ uid: adminUid, tags: ['nodebb'], title: 'topic title 2', content: 'topic 2 content', cid: topic.categoryId }, next);
				},
			}, function (err, results) {
				assert.ifError(err);
				tid1 = results.topic1.topicData.tid;
				tid2 = results.topic2.topicData.tid;
				done();
			});
		});

		it('should return suggested topics', function (done) {
			topics.getSuggestedTopics(tid1, adminUid, 0, -1, function (err, topics) {
				assert.ifError(err);
				assert(Array.isArray(topics));
				done();
			});
		});
	});

	describe('unread', function () {
		var socketTopics = require('../src/socket.io/topics');
		var tid;
		var mainPid;
		var uid;
		before(function (done) {
			async.parallel({
				topic: function (next) {
					topics.post({ uid: topic.userId, title: 'unread topic', content: 'unread topic content', cid: topic.categoryId }, next);
				},
				user: function (next) {
					User.create({ username: 'regularJoe' }, next);
				},
			}, function (err, results) {
				assert.ifError(err);
				tid = results.topic.topicData.tid;
				mainPid = results.topic.postData.pid;
				uid = results.user;
				done();
			});
		});

		it('should fail with invalid data', function (done) {
			socketTopics.markUnread({ uid: adminUid }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should fail if topic does not exist', function (done) {
			socketTopics.markUnread({ uid: adminUid }, 1231082, function (err) {
				assert.equal(err.message, '[[error:no-topic]]');
				done();
			});
		});

		it('should mark topic unread', function (done) {
			socketTopics.markUnread({ uid: adminUid }, tid, function (err) {
				assert.ifError(err);
				topics.hasReadTopic(tid, adminUid, function (err, hasRead) {
					assert.ifError(err);
					assert.equal(hasRead, false);
					done();
				});
			});
		});


		it('should fail with invalid data', function (done) {
			socketTopics.markAsRead({ uid: 0 }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});


		it('should mark topic read', function (done) {
			socketTopics.markAsRead({ uid: adminUid }, [tid], function (err) {
				assert.ifError(err);
				topics.hasReadTopic(tid, adminUid, function (err, hasRead) {
					assert.ifError(err);
					assert(hasRead);
					done();
				});
			});
		});

		it('should fail with invalid data', function (done) {
			socketTopics.markTopicNotificationsRead({ uid: 0 }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should mark topic notifications read', function (done) {
			var socketPosts = require('../src/socket.io/posts');

			async.waterfall([
				function (next) {
					socketTopics.follow({ uid: adminUid }, tid, next);
				},
				function (next) {
					socketPosts.reply({ uid: uid }, { content: 'some content', tid: tid }, next);
				},
				function (data, next) {
					setTimeout(next, 2500);
				},
				function (next) {
					User.notifications.getUnreadCount(adminUid, next);
				},
				function (count, next) {
					assert.equal(count, 1);
					socketTopics.markTopicNotificationsRead({ uid: adminUid }, [tid], next);
				},
				function (next) {
					User.notifications.getUnreadCount(adminUid, next);
				},
				function (count, next) {
					assert.equal(count, 0);
					next();
				},
			], function (err) {
				assert.ifError(err);
				done();
			});
		});

		it('should fail with invalid data', function (done) {
			socketTopics.markAllRead({ uid: 0 }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-uid]]');
				done();
			});
		});

		it('should mark all read', function (done) {
			socketTopics.markUnread({ uid: adminUid }, tid, function (err) {
				assert.ifError(err);
				socketTopics.markAllRead({ uid: adminUid }, {}, function (err) {
					assert.ifError(err);
					topics.hasReadTopic(tid, adminUid, function (err, hasRead) {
						assert.ifError(err);
						assert(hasRead);
						done();
					});
				});
			});
		});

		it('should mark category topics read', function (done) {
			socketTopics.markUnread({ uid: adminUid }, tid, function (err) {
				assert.ifError(err);
				socketTopics.markCategoryTopicsRead({ uid: adminUid }, topic.categoryId, function (err) {
					assert.ifError(err);
					topics.hasReadTopic(tid, adminUid, function (err, hasRead) {
						assert.ifError(err);
						assert(hasRead);
						done();
					});
				});
			});
		});


		it('should fail with invalid data', function (done) {
			socketTopics.markAsUnreadForAll({ uid: adminUid }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-tid]]');
				done();
			});
		});

		it('should fail with invalid data', function (done) {
			socketTopics.markAsUnreadForAll({ uid: 0 }, [tid], function (err) {
				assert.equal(err.message, '[[error:no-privileges]]');
				done();
			});
		});

		it('should fail if user is not admin', function (done) {
			socketTopics.markAsUnreadForAll({ uid: uid }, [tid], function (err) {
				assert.equal(err.message, '[[error:no-privileges]]');
				done();
			});
		});

		it('should fail if topic does not exist', function (done) {
			socketTopics.markAsUnreadForAll({ uid: uid }, [12312313], function (err) {
				assert.equal(err.message, '[[error:no-topic]]');
				done();
			});
		});

		it('should mark topic unread for everyone', function (done) {
			socketTopics.markAsUnreadForAll({ uid: adminUid }, [tid], function (err) {
				assert.ifError(err);
				async.parallel({
					adminRead: function (next) {
						topics.hasReadTopic(tid, adminUid, next);
					},
					regularRead: function (next) {
						topics.hasReadTopic(tid, uid, next);
					},
				}, function (err, results) {
					assert.ifError(err);
					assert.equal(results.adminRead, false);
					assert.equal(results.regularRead, false);
					done();
				});
			});
		});

		it('should not do anything if tids is empty array', function (done) {
			socketTopics.markAsRead({ uid: adminUid }, [], function (err, markedRead) {
				assert.ifError(err);
				assert(!markedRead);
				done();
			});
		});
	});

	describe('tags', function () {
		var socketTopics = require('../src/socket.io/topics');
		var socketAdmin = require('../src/socket.io/admin');

		before(function (done) {
			async.parallel({
				topic1: function (next) {
					topics.post({ uid: adminUid, tags: ['php', 'nosql', 'psql', 'nodebb'], title: 'topic title 1', content: 'topic 1 content', cid: topic.categoryId }, next);
				},
				topic2: function (next) {
					topics.post({ uid: adminUid, tags: ['javascript', 'mysql', 'python', 'nodejs'], title: 'topic title 2', content: 'topic 2 content', cid: topic.categoryId }, next);
				},
			}, function (err) {
				assert.ifError(err);
				done();
			});
		});

		it('should return empty array if query is falsy', function (done) {
			socketTopics.autocompleteTags({ uid: adminUid }, { query: '' }, function (err, data) {
				assert.ifError(err);
				assert.deepEqual([], data);
				done();
			});
		});

		it('should autocomplete tags', function (done) {
			socketTopics.autocompleteTags({ uid: adminUid }, { query: 'p' }, function (err, data) {
				assert.ifError(err);
				['php', 'psql', 'python'].forEach(function (tag) {
					assert.notEqual(data.indexOf(tag), -1);
				});
				done();
			});
		});

		it('should return empty array if query is falsy', function (done) {
			socketTopics.searchTags({ uid: adminUid }, { query: '' }, function (err, data) {
				assert.ifError(err);
				assert.deepEqual([], data);
				done();
			});
		});

		it('should search tags', function (done) {
			socketTopics.searchTags({ uid: adminUid }, { query: 'no' }, function (err, data) {
				assert.ifError(err);
				['nodebb', 'nodejs', 'nosql'].forEach(function (tag) {
					assert.notEqual(data.indexOf(tag), -1);
				});
				done();
			});
		});

		it('should return empty array if query is falsy', function (done) {
			socketTopics.searchAndLoadTags({ uid: adminUid }, { query: '' }, function (err, data) {
				assert.ifError(err);
				assert.equal(data.matchCount, 0);
				assert.equal(data.pageCount, 1);
				assert.deepEqual(data.tags, []);
				done();
			});
		});

		it('should search and load tags', function (done) {
			socketTopics.searchAndLoadTags({ uid: adminUid }, { query: 'no' }, function (err, data) {
				assert.ifError(err);
				assert.equal(data.matchCount, 3);
				assert.equal(data.pageCount, 1);
				var tagData = [
					{ value: 'nodebb', color: '', bgColor: '', score: 3 },
					{ value: 'nodejs', color: '', bgColor: '', score: 1 },
					{ value: 'nosql', color: '', bgColor: '', score: 1 },
				];
				assert.deepEqual(data.tags, tagData);

				done();
			});
		});

		it('should return error if data is invalid', function (done) {
			socketTopics.loadMoreTags({ uid: adminUid }, { after: 'asd' }, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should load more tags', function (done) {
			socketTopics.loadMoreTags({ uid: adminUid }, { after: 0 }, function (err, data) {
				assert.ifError(err);
				assert(Array.isArray(data.tags));
				assert.equal(data.nextStart, 100);
				done();
			});
		});

		it('should error if data is invalid', function (done) {
			socketAdmin.tags.create({ uid: adminUid }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should error if tag is invalid', function (done) {
			socketAdmin.tags.create({ uid: adminUid }, { tag: '' }, function (err) {
				assert.equal(err.message, '[[error:invalid-tag]]');
				done();
			});
		});

		it('should error if tag is too short', function (done) {
			socketAdmin.tags.create({ uid: adminUid }, { tag: 'as' }, function (err) {
				assert.equal(err.message, '[[error:tag-too-short]]');
				done();
			});
		});

		it('should create empty tag', function (done) {
			socketAdmin.tags.create({ uid: adminUid }, { tag: 'emptytag' }, function (err) {
				assert.ifError(err);
				db.sortedSetScore('tags:topic:count', 'emptytag', function (err, score) {
					assert.ifError(err);
					assert.equal(score, 0);
					done();
				});
			});
		});

		it('should do nothing if tag exists', function (done) {
			socketAdmin.tags.create({ uid: adminUid }, { tag: 'emptytag' }, function (err) {
				assert.ifError(err);
				db.sortedSetScore('tags:topic:count', 'emptytag', function (err, score) {
					assert.ifError(err);
					assert.equal(score, 0);
					done();
				});
			});
		});

		it('should error if data is invalid', function (done) {
			socketAdmin.tags.update({ uid: adminUid }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should error if data.tag is invalid', function (done) {
			socketAdmin.tags.update({ uid: adminUid }, {
				bgColor: '#ff0000',
				color: '#00ff00',
			}, function (err) {
				assert.equal(err.message, '[[error:invalid-tag]]');
				done();
			});
		});

		it('should update tag', function (done) {
			socketAdmin.tags.update({ uid: adminUid }, {
				tag: 'emptytag',
				bgColor: '#ff0000',
				color: '#00ff00',
			}, function (err) {
				assert.ifError(err);
				db.getObject('tag:emptytag', function (err, data) {
					assert.ifError(err);
					assert.equal(data.bgColor, '#ff0000');
					assert.equal(data.color, '#00ff00');
					done();
				});
			});
		});

		it('should return related topics', function (done) {
			var meta = require('../src/meta');
			meta.config.maximumRelatedTopics = 2;
			var topicData = {
				tags: [{ value: 'javascript' }],
			};
			topics.getRelatedTopics(topicData, 0, function (err, data) {
				assert.ifError(err);
				assert(Array.isArray(data));
				assert.equal(data[0].title, 'topic title 2');
				meta.config.maximumRelatedTopics = 0;
				done();
			});
		});

		it('should return error with invalid data', function (done) {
			socketAdmin.tags.deleteTags({ uid: adminUid }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should do nothing if arrays is empty', function (done) {
			socketAdmin.tags.deleteTags({ uid: adminUid }, { tags: [] }, function (err) {
				assert.ifError(err);
				done();
			});
		});

		it('should delete tags', function (done) {
			socketAdmin.tags.create({ uid: adminUid }, { tag: 'emptytag2' }, function (err) {
				assert.ifError(err);
				socketAdmin.tags.deleteTags({ uid: adminUid }, { tags: ['emptytag', 'emptytag2', 'nodebb', 'nodejs'] }, function (err) {
					assert.ifError(err);
					db.getObjects(['tag:emptytag', 'tag:emptytag2'], function (err, data) {
						assert.ifError(err);
						assert(!data[0]);
						assert(!data[1]);
						done();
					});
				});
			});
		});

		it('should delete tag', function (done) {
			topics.deleteTag('javascript', function (err) {
				assert.ifError(err);
				db.getObject('tag:javascript', function (err, data) {
					assert.ifError(err);
					assert(!data);
					done();
				});
			});
		});
	});

	describe('follow/unfollow', function () {
		var socketTopics = require('../src/socket.io/topics');
		var tid;
		var followerUid;
		before(function (done) {
			User.create({ username: 'follower' }, function (err, uid) {
				if (err) {
					return done(err);
				}
				followerUid = uid;
				topics.post({ uid: adminUid, title: 'topic title', content: 'some content', cid: topic.categoryId }, function (err, result) {
					if (err) {
						return done(err);
					}
					tid = result.topicData.tid;
					done();
				});
			});
		});

		it('should error if not logged in', function (done) {
			socketTopics.changeWatching({ uid: 0 }, { tid: tid, type: 'ignore' }, function (err) {
				assert.equal(err.message, '[[error:not-logged-in]]');
				done();
			});
		});

		it('should filter ignoring uids', function (done) {
			socketTopics.changeWatching({ uid: followerUid }, { tid: tid, type: 'ignore' }, function (err) {
				assert.ifError(err);
				topics.filterIgnoringUids(tid, [adminUid, followerUid], function (err, uids) {
					assert.ifError(err);
					assert.equal(uids.length, 1);
					assert.equal(uids[0], adminUid);
					done();
				});
			});
		});

		it('should error with invalid data', function (done) {
			socketTopics.changeWatching({ uid: followerUid }, {}, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should error with invalid type', function (done) {
			socketTopics.changeWatching({ uid: followerUid }, { tid: tid, type: 'derp' }, function (err) {
				assert.equal(err.message, '[[error:invalid-command]]');
				done();
			});
		});

		it('should follow topic', function (done) {
			topics.toggleFollow(tid, followerUid, function (err, isFollowing) {
				assert.ifError(err);
				assert(isFollowing);
				socketTopics.isFollowed({ uid: followerUid }, tid, function (err, isFollowing) {
					assert.ifError(err);
					assert(isFollowing);
					done();
				});
			});
		});
	});

	describe('topics search', function () {
		it('should error with invalid data', function (done) {
			socketTopics.search({ uid: adminUid }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should return results', function (done) {
			var plugins = require('../src/plugins');
			plugins.registerHook('myTestPlugin', {
				hook: 'filter:topic.search',
				method: function (data, callback) {
					callback(null, [1, 2, 3]);
				},
			});
			socketTopics.search({ uid: adminUid }, { tid: topic.tid, term: 'test' }, function (err, results) {
				assert.ifError(err);
				assert.deepEqual(results, [1, 2, 3]);
				done();
			});
		});
	});

	it('should check if user is moderator', function (done) {
		socketTopics.isModerator({ uid: adminUid }, topic.tid, function (err, isModerator) {
			assert.ifError(err);
			assert(!isModerator);
			done();
		});
	});

	describe('teasers', function () {
		var topic1;
		var topic2;
		before(function (done) {
			async.series([
				function (next) {
					topics.post({ uid: adminUid, title: 'topic 1', content: 'content 1', cid: categoryObj.cid }, next);
				},
				function (next) {
					topics.post({ uid: adminUid, title: 'topic 2', content: 'content 2', cid: categoryObj.cid }, next);
				},
			], function (err, results) {
				assert.ifError(err);
				topic1 = results[0];
				topic2 = results[1];
				done();
			});
		});

		after(function (done) {
			meta.config.teaserPost = '';
			done();
		});


		it('should return empty array if first param is empty', function (done) {
			topics.getTeasers([], 1, function (err, teasers) {
				assert.ifError(err);
				assert.equal(0, teasers.length);
				done();
			});
		});

		it('should get teasers with 2 params', function (done) {
			topics.getTeasers([topic1.topicData, topic2.topicData], 1, function (err, teasers) {
				assert.ifError(err);
				assert.deepEqual([undefined, undefined], teasers);
				done();
			});
		});

		it('should get teasers with first posts', function (done) {
			meta.config.teaserPost = 'first';
			topics.getTeasers([topic1.topicData, topic2.topicData], 1, function (err, teasers) {
				assert.ifError(err);
				assert.equal(2, teasers.length);
				assert(teasers[0]);
				assert(teasers[1]);
				assert(teasers[0].tid, topic1.topicData.tid);
				assert(teasers[0].content, 'content 1');
				assert(teasers[0].user.username, 'admin');
				done();
			});
		});

		it('should get teasers even if one topic is falsy', function (done) {
			topics.getTeasers([null, topic2.topicData], 1, function (err, teasers) {
				assert.ifError(err);
				assert.equal(2, teasers.length);
				assert.equal(undefined, teasers[0]);
				assert(teasers[1]);
				assert(teasers[1].tid, topic2.topicData.tid);
				assert(teasers[1].content, 'content 2');
				assert(teasers[1].user.username, 'admin');
				done();
			});
		});

		it('should get teasers with first posts', function (done) {
			meta.config.teaserPost = 'last-post';
			topics.reply({ uid: adminUid, content: 'reply 1 content', tid: topic1.topicData.tid }, function (err, result) {
				assert.ifError(err);
				topic1.topicData.teaserPid = result.pid;
				topics.getTeasers([topic1.topicData, topic2.topicData], 1, function (err, teasers) {
					assert.ifError(err);
					assert(teasers[0]);
					assert(teasers[1]);
					assert(teasers[0].tid, topic1.topicData.tid);
					assert(teasers[0].content, 'reply 1 content');
					done();
				});
			});
		});

		it('should get teasers by tids', function (done) {
			topics.getTeasersByTids([topic2.topicData.tid, topic1.topicData.tid], 1, function (err, teasers) {
				assert.ifError(err);
				assert(2, teasers.length);
				assert.equal(teasers[1].content, 'reply 1 content');
				done();
			});
		});

		it('should return empty array ', function (done) {
			topics.getTeasersByTids([], 1, function (err, teasers) {
				assert.ifError(err);
				assert.equal(0, teasers.length);
				done();
			});
		});

		it('should get teaser by tid', function (done) {
			topics.getTeaser(topic2.topicData.tid, 1, function (err, teaser) {
				assert.ifError(err);
				assert(teaser);
				assert.equal(teaser.content, 'content 2');
				done();
			});
		});
	});

	describe('tag privilege', function () {
		var uid;
		var cid;
		before(function (done) {
			async.waterfall([
				function (next) {
					User.create({ username: 'tag_poster' }, next);
				},
				function (_uid, next) {
					uid = _uid;
					categories.create({ name: 'tag category' }, next);
				},
				function (categoryObj, next) {
					cid = categoryObj.cid;
					next();
				},
			], done);
		});

		it('should fail to post if user does not have tag privilege', function (done) {
			privileges.categories.rescind(['topics:tag'], cid, 'registered-users', function (err) {
				assert.ifError(err);
				topics.post({ uid: uid, cid: cid, tags: ['tag1'], title: 'topic with tags', content: 'some content here' }, function (err) {
					assert.equal(err.message, '[[error:no-privileges]]');
					done();
				});
			});
		});

		it('should fail to edit if user does not have tag privilege', function (done) {
			topics.post({ uid: uid, cid: cid, title: 'topic with tags', content: 'some content here' }, function (err, result) {
				assert.ifError(err);
				var pid = result.postData.pid;
				posts.edit({ pid: pid, uid: uid, content: 'edited content', tags: ['tag2'] }, function (err) {
					assert.equal(err.message, '[[error:no-privileges]]');
					done();
				});
			});
		});

		it('should be able to edit topic and add tags if allowed', function (done) {
			privileges.categories.give(['topics:tag'], cid, 'registered-users', function (err) {
				assert.ifError(err);
				topics.post({ uid: uid, cid: cid, tags: ['tag1'], title: 'topic with tags', content: 'some content here' }, function (err, result) {
					assert.ifError(err);
					posts.edit({ pid: result.postData.pid, uid: uid, content: 'edited content', tags: ['tag1', 'tag2'] }, function (err, result) {
						assert.ifError(err);
						var tags = result.topic.tags.map(function (tag) {
							return tag.value;
						});
						assert(tags.indexOf('tag1') !== -1);
						assert(tags.indexOf('tag2') !== -1);
						done();
					});
				});
			});
		});
	});

	describe('topic merge', function (done) {
		var uid;
		var topic1Data;
		var topic2Data;

		before(function (done) {
			async.waterfall([
				function (next) {
					User.create({ username: 'mergevictim' }, next);
				},
				function (_uid, next) {
					uid = _uid;
					topics.post({ uid: uid, cid: categoryObj.cid, title: 'topic 1', content: 'topic 1 OP' }, next);
				},
				function (result, next) {
					topic1Data = result.topicData;
					topics.post({ uid: uid, cid: categoryObj.cid, title: 'topic 2', content: 'topic 2 OP' }, next);
				},
				function (result, next) {
					topic2Data = result.topicData;
					topics.reply({ uid: uid, content: 'topic 1 reply', tid: topic1Data.tid }, next);
				},
				function (postData, next) {
					topics.reply({ uid: uid, content: 'topic 2 reply', tid: topic2Data.tid }, next);
				},
			], done);
		});

		it('should error if data is not an array', function (done) {
			socketTopics.merge({ uid: 0 }, null, function (err) {
				assert.equal(err.message, '[[error:invalid-data]]');
				done();
			});
		});

		it('should error if user does not have privileges', function (done) {
			socketTopics.merge({ uid: 0 }, [topic2Data.tid, topic1Data.tid], function (err) {
				assert.equal(err.message, '[[error:no-privileges]]');
				done();
			});
		});

		it('should merge 2 topics', function (done) {
			async.waterfall([
				function (next) {
					socketTopics.merge({ uid: adminUid }, [topic2Data.tid, topic1Data.tid], next);
				},
				function (next) {
					async.parallel({
						topic1: function (next) {
							async.waterfall([
								function (next) {
									topics.getTopicData(topic1Data.tid, next);
								},
								function (topicData, next) {
									topics.getTopicWithPosts(topicData, 'tid:' + topicData.tid + ':posts', adminUid, 0, 19, false, next);
								},
							], next);
						},
						topic2: function (next) {
							async.waterfall([
								function (next) {
									topics.getTopicData(topic2Data.tid, next);
								},
								function (topicData, next) {
									topics.getTopicWithPosts(topicData, 'tid:' + topicData.tid + ':posts', adminUid, 0, 19, false, next);
								},
							], next);
						},
					}, next);
				},
				function (results, next) {
					assert.equal(results.topic1.posts.length, 4);
					assert.equal(results.topic2.posts.length, 0);

					assert.equal(results.topic1.posts[0].content, 'topic 1 OP');
					assert.equal(results.topic1.posts[1].content, 'topic 2 OP');
					assert.equal(results.topic1.posts[2].content, 'topic 1 reply');
					assert.equal(results.topic1.posts[3].content, 'topic 2 reply');
					done();
				},
			], done);
		});
	});
});
