# After Life tools (MCP and CLI)

Run `node <skill-dir>/scripts/afterlife.mjs tools` to inspect granted tools and
their current JSON schemas. With MCP, use the host's tool discovery. Tools bind
the authenticated user; grants can change or be revoked between requests.

| Capability        | Tools and key inputs                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile/status    | `afterlife_get_my_profile`, `afterlife_get_check_in_status`                                                                                                         |
| Contacts          | `afterlife_list_contacts({page?,pageSize?})`, `afterlife_get_contact({contactUuid})`                                                                                |
| Letters           | `afterlife_list_letters({page?,pageSize?})`, `afterlife_get_letter({letterUuid})`                                                                                   |
| Full body         | `afterlife_read_letter_content({letterUuid,offset?,expectedUpdatedAt?})`; follow `nextOffset` until null, pin the version                                           |
| Create contact    | `afterlife_create_contact({name,email?,phone?,note?})`; email or phone required                                                                                     |
| Edit contact      | `afterlife_update_contact({contactUuid,expectedUpdatedAt,name?,email?,phone?,note?})`; null clears optional fields                                                  |
| Create letter     | `afterlife_create_letter({title,content,contentFormat?,contactUuids?,inactiveAfterMinutes?})`; defaults to sanitized HTML and disabled detection                    |
| Edit letter       | `afterlife_update_letter({letterUuid,expectedUpdatedAt,title?,content?,contentFormat?,contactUuids?,inactiveAfterMinutes?})`; HTML/Markdown/plain text              |
| Preview detection | `afterlife_preview_delivery({letterUuid,inactiveAfterMinutes})`; returns version, `previewUuid`, recipients, due time, attachments and `requiresHumanApproval`      |
| Set detection     | `afterlife_set_delivery({letterUuid,expectedUpdatedAt,enabled,previewUuid?})`; enable needs a fresh ready/approved preview; disable does not                        |
| List files        | `afterlife_list_letter_resources({letterUuid,page?,pageSize?})`                                                                                                     |
| Access file       | `afterlife_get_resource_access({resourceUuid})`; short-lived private download path                                                                                  |
| Upload file       | CLI `upload FILE [--mime TYPE]`; MCP `afterlife_prepare_resource_upload({filename,mimeType,sizeBytes})`, then POST multipart `file` with returned temporary headers |
| Human activity    | `afterlife_record_check_in({eventId,occurredAt})`; original UTC timestamp and stable event ID                                                                       |

## CLI examples

After the human has provisioned `AFTERLIFE_SERVER_URL` and the credential file:

```bash
node <skill-dir>/scripts/afterlife.mjs tools
node <skill-dir>/scripts/afterlife.mjs call afterlife_get_my_profile
node <skill-dir>/scripts/afterlife.mjs call afterlife_list_letters --input - <<'JSON'
{"page":1,"pageSize":20}
JSON
node <skill-dir>/scripts/afterlife.mjs upload /path/to/private-file.pdf
```

For long or private bodies, use a JSON input file in a private temporary
directory. Upload only creates a resource; attach it by updating letter content
with `/resource/UUID`. No command sends a letter immediately.

## Limits and recovery

Lists contain at most 50 items per page; detail relations at most 100. Check
counts and truncation flags. Bodies return at most 20000 characters per segment;
modern writes permit 100000. Letters accept at most 100 unique contact UUIDs.
Files are at most 10 MB, with a 100 MB user quota. Upload tickets expire in five
minutes and are single-use; detection previews expire in ten minutes and bind
the originating grant and letter version. Create a new ticket after a failed
upload. If a write times out, read current state before retrying.

Overdue previews must be approved by the human in the web AI access page before
commit. Re-preview if a previously safe preview becomes overdue. A version
conflict requires rereading and reconciling, not blindly replaying the old edit.

Delegated events must be within five minutes and not future-dated. Duplicate
retries do not renew time; activity advances at most once per minute.

Legacy credentials retain the old draft tools `afterlife_create_letter_draft`
and `afterlife_update_letter_draft` (20000-character Markdown/plain text,
detection disabled). They do not gain new capabilities automatically. Ask the
human to create a named grant for additional permissions.
