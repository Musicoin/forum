<div class="row events">
	<div class="col-lg-9">
		<div class="panel panel-default">
			<div class="panel-heading"><i class="fa fa-calendar-o"></i> [[admin/advanced/events:events]]</div>
			<div class="panel-body" data-next="{next}">
				<!-- IF !events.length -->
				<div class="alert alert-info">[[admin/advanced/events:no-events]]</div>
				<!-- ENDIF !events.length -->
				<div class="events-list">
				<!-- BEGIN events -->
				<div>
					<span>#{events.eid} </span><span class="label label-info">{events.type}</span>
					<a href="{config.relative_path}/user/{events.user.userslug}" target="_blank">
						<!-- IF events.user.picture -->
						<img class="avatar avatar-sm" src="{events.user.picture}" />
						<!-- ELSE -->
						<div class="avatar avatar-sm" style="background-color: {events.user.icon:bgColor};">{events.user.icon:text}</div>
						<!-- ENDIF events.user.picture -->
					</a>
					<a href="{config.relative_path}/user/{events.user.userslug}" target="_blank">{events.user.username}</a> (uid {events.uid}) (IP {events.ip})
					<span class="pull-right">{events.timestampISO}</span>
					<br /><br />
					<pre>{events.jsonString}</pre>
				</div>
				<!-- END events -->
				<!-- IMPORT partials/paginator.tpl -->
				</div>
			</div>
		</div>
	</div>
	<div class="col-lg-3 acp-sidebar">
		<div class="panel panel-default">
			<div class="panel-heading"></div>
			<div class="panel-body">
				<button class="btn btn-warning" data-action="clear">
					<i class="fa fa-eraser"></i> [[admin/advanced/events:delete-events]]
				</button>
			</div>
		</div>
	</div>
</div>
