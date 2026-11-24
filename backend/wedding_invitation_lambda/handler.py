import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import time
import unicodedata
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

TABLE_NAME = os.environ["TABLE_NAME"]
RATE_LIMIT_SALT = os.environ["RATE_LIMIT_SALT"].encode("utf-8")
RATE_LIMIT_MAX = 10
RATE_LIMIT_WINDOW_SECONDS = 600
MAX_BODY_BYTES = 2048
MAX_NAME_LENGTH = 50
MAX_MESSAGE_LENGTH = 400
PUBLIC_WISH_LIMIT = 4
PHOTO_MAX_BYTES = 10 * 1024 * 1024
PHOTO_UPLOAD_RATE_LIMIT_MAX = 10
PHOTO_UPLOAD_RATE_LIMIT_WINDOW_SECONDS = 600
PHOTO_ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
PHOTO_BUCKET = os.environ.get("PHOTO_BUCKET", "")
with open(os.path.join(os.path.dirname(__file__), "gifts.json"), encoding="utf-8") as gifts_file:
    GIFT_CATALOG = json.load(gifts_file)

GIFT_BY_ID = {gift["id"]: gift for gift in GIFT_CATALOG}
if len(GIFT_BY_ID) != len(GIFT_CATALOG):
    raise ValueError("Gift catalogue contains duplicate IDs")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def response(status_code, payload, extra_headers=None, cache_control="no-store, max-age=0"):
    headers = {
        "content-type": "application/json; charset=utf-8",
        "cache-control": cache_control,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
    }
    if extra_headers:
        headers.update(extra_headers)
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(payload, ensure_ascii=False),
        "isBase64Encoded": False,
    }


def request_ip(event):
    headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
    forwarded = headers.get("cloudfront-viewer-address", "").strip()
    if not forwarded:
        return None

    # CloudFront sends IPv4:port or [IPv6]:port.
    if forwarded.startswith("[") and "]" in forwarded:
        address = forwarded[1:forwarded.index("]")]
    elif forwarded.count(":") == 1:
        address = forwarded.rsplit(":", 1)[0]
    else:
        address = forwarded

    try:
        return str(ipaddress.ip_address(address))
    except ValueError:
        return None


def apply_rate_limit(client_ip):
    now = int(time.time())
    window_start = (now // RATE_LIMIT_WINDOW_SECONDS) * RATE_LIMIT_WINDOW_SECONDS
    window_end = window_start + RATE_LIMIT_WINDOW_SECONDS
    digest = hmac.new(RATE_LIMIT_SALT, client_ip.encode("utf-8"), hashlib.sha256).hexdigest()

    try:
        table.update_item(
            Key={
                "pk": f"RATE#{digest}",
                "sk": f"WINDOW#{window_start}",
            },
            UpdateExpression="SET expires_at = if_not_exists(expires_at, :expires) ADD request_count :one",
            ConditionExpression="attribute_not_exists(request_count) OR request_count < :limit",
            ExpressionAttributeValues={
                ":expires": window_end + 3600,
                ":one": 1,
                ":limit": RATE_LIMIT_MAX,
            },
        )
        return True
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code == "ConditionalCheckFailedException":
            return False
        raise


def clean_text(value):
    if not isinstance(value, str):
        return ""
    value = unicodedata.normalize("NFKC", value).strip()
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)


def parse_body(event):
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(body, validate=True)
        except (ValueError, TypeError):
            return None, "invalid"
    else:
        raw = body.encode("utf-8") if isinstance(body, str) else b""

    if len(raw) > MAX_BODY_BYTES:
        return None, "too_large"

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "invalid"

    if not isinstance(payload, dict):
        return None, "invalid"
    if set(payload) - {"name", "message", "website"}:
        return None, "invalid"

    name = clean_text(payload.get("name"))
    message = clean_text(payload.get("message"))
    website = clean_text(payload.get("website", ""))

    if not name or len(name) > MAX_NAME_LENGTH:
        return None, "invalid"
    if not message or len(message) > MAX_MESSAGE_LENGTH:
        return None, "invalid"

    return {"name": name, "message": message, "website": website}, None


def submit_wish(event):
    print(f"Wish received from user. Processing...")
    headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
    if not headers.get("content-type", "").lower().startswith("application/json"):
        return response(415, {"error": "Content-Type must be application/json."})

    payload, error = parse_body(event)
    if error == "too_large":
        return response(413, {"error": "The request is too large."})
    if error:
        return response(400, {"error": "Enter a name and a message within the allowed limits."})

    # Honeypot: respond as if accepted, but do not write bot submissions.
    if payload["website"]:
        return response(202, {"message": "Thank you. Your wish has been received for review."})

    client_ip = request_ip(event)
    if not client_ip:
        return response(400, {"error": "The request could not be verified."})

    try:
        if not apply_rate_limit(client_ip):
            return response(
                429,
                {"error": "Please wait a few minutes before sending another wish."},
                {"retry-after": str(RATE_LIMIT_WINDOW_SECONDS)},
            )

        print("Wish validated. Saving to database...")

        wish_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        table.put_item(
            Item={
                "pk": f"WISH#{wish_id}",
                "sk": "METADATA",
                "wishId": wish_id,
                "name": payload["name"],
                "message": payload["message"],
                "status": "APPROVED",
                "createdAt": created_at,
                "gsi1pk": "STATUS#APPROVED",
                "gsi1sk": f"{created_at}#{wish_id}",
            },
            ConditionExpression="attribute_not_exists(pk)",
        )
        print("Successfully saved wish:", wish_id)
    except ClientError:
        return response(503, {"error": "We could not save your wish right now. Please try again later."})

    return response(201, {"message": "Thank you! Your wish has been published."})


def list_wishes():
    print("Listing wishes")
    try:
        result = table.query(
            IndexName="status-created_at-index",
            KeyConditionExpression=Key("gsi1pk").eq("STATUS#APPROVED"),
            ScanIndexForward=False,
            Limit=PUBLIC_WISH_LIMIT,
        )
    except ClientError:
        return response(503, {"error": "Wishes are temporarily unavailable."})

    wishes = [
        {
            "wishId": item["wishId"],
            "name": item["name"],
            "message": item["message"],
            "createdAt": item["createdAt"],
        }
        for item in result.get("Items", [])
    ]
    return response(200, {"wishes": wishes}, cache_control="public, max-age=30, s-maxage=30")



def parse_gift_body(event, allowed_fields):
    headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
    if not headers.get("content-type", "").lower().startswith("application/json"):
        return None, response(415, {"error": "Content-Type must be application/json."})

    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(body, validate=True)
        except (ValueError, TypeError):
            return None, response(400, {"error": "Invalid request body."})
    else:
        raw = body.encode("utf-8") if isinstance(body, str) else b""

    if len(raw) > MAX_BODY_BYTES:
        return None, response(413, {"error": "The request is too large."})

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, response(400, {"error": "Invalid request body."})

    if not isinstance(payload, dict) or set(payload) != set(allowed_fields):
        return None, response(400, {"error": "Invalid request body."})
    return payload, None


def gift_id_is_valid(gift_id):
    return isinstance(gift_id, str) and gift_id in GIFT_BY_ID


def check_gift_request_limit(event):
    client_ip = request_ip(event)
    if not client_ip:
        return response(400, {"error": "The request could not be verified."})
    try:
        if not apply_rate_limit(client_ip):
            return response(
                429,
                {"error": "Please wait a few minutes before trying again."},
                {"retry-after": str(RATE_LIMIT_WINDOW_SECONDS)},
            )
    except ClientError:
        return response(503, {"error": "Gift reservations are temporarily unavailable."})
    return None


def list_gifts():
    gifts = []
    try:
        for gift in GIFT_CATALOG:
            gift_id = gift["id"]
            result = table.get_item(Key={"pk": f"GIFT#{gift_id}", "sk": "RESERVATION"})
            item = result.get("Item") or {}
            status = "RESERVED" if item.get("status") == "RESERVED" else "AVAILABLE"
            gifts.append({
                "giftId": gift_id,
                "name": gift["name"],
                "detail": gift["detail"],
                "image": gift["image"],
                "status": status,
            })
    except ClientError:
        return response(503, {"error": "Gift reservations are temporarily unavailable."})
    return response(200, {"gifts": gifts})


def reserve_gift(event):
    payload, error_response = parse_gift_body(event, {"giftId", "name"})
    if error_response:
        return error_response

    gift_id = payload.get("giftId")
    name = clean_text(payload.get("name"))
    if not gift_id_is_valid(gift_id) or not name or len(name) > MAX_NAME_LENGTH:
        return response(400, {"error": "Enter a valid name and select a valid gift."})

    limit_response = check_gift_request_limit(event)
    if limit_response:
        return limit_response

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    try:
        table.update_item(
            Key={"pk": f"GIFT#{gift_id}", "sk": "RESERVATION"},
            UpdateExpression="SET #status = :reserved, reserved_by = :name, reservation_token_hash = :token_hash, created_at = :created_at",
            ConditionExpression="attribute_not_exists(#status) OR #status = :available",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":reserved": "RESERVED",
                ":available": "AVAILABLE",
                ":name": name,
                ":token_hash": token_hash,
                ":created_at": created_at,
            },
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code == "ConditionalCheckFailedException":
            return response(409, {"error": "Sorry, this gift has just been reserved by someone else."})
        return response(503, {"error": "We couldn't reserve this gift right now. Please try again."})

    print(f"Gift reservation created: {gift_id}")
    return response(201, {"message": "Gift reserved successfully.", "reservationToken": token})


def unreserve_gift(event):
    payload, error_response = parse_gift_body(event, {"giftId", "reservationToken"})
    if error_response:
        return error_response

    gift_id = payload.get("giftId")
    token = payload.get("reservationToken")
    if not gift_id_is_valid(gift_id) or not isinstance(token, str) or not 32 <= len(token) <= 128:
        return response(400, {"error": "Invalid reservation details."})

    limit_response = check_gift_request_limit(event)
    if limit_response:
        return limit_response

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    try:
        table.update_item(
            Key={"pk": f"GIFT#{gift_id}", "sk": "RESERVATION"},
            UpdateExpression="SET #status = :available REMOVE reserved_by, reservation_token_hash, created_at",
            ConditionExpression="#status = :reserved AND reservation_token_hash = :token_hash",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":available": "AVAILABLE",
                ":reserved": "RESERVED",
                ":token_hash": token_hash,
            },
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code == "ConditionalCheckFailedException":
            return response(403, {"error": "Only the guest who made this reservation can unreserve it."})
        return response(503, {"error": "We couldn't cancel this reservation right now. Please try again."})

    print(f"Gift reservation cancelled: {gift_id}")
    return response(200, {"message": "Reservation cancelled successfully."})


def apply_photo_upload_rate_limit(client_ip):
    """Limit presigned upload authorizations without storing photo metadata."""
    now = int(time.time())
    window_start = (now // PHOTO_UPLOAD_RATE_LIMIT_WINDOW_SECONDS) * PHOTO_UPLOAD_RATE_LIMIT_WINDOW_SECONDS
    window_end = window_start + PHOTO_UPLOAD_RATE_LIMIT_WINDOW_SECONDS
    digest = hmac.new(RATE_LIMIT_SALT, client_ip.encode("utf-8"), hashlib.sha256).hexdigest()

    try:
        table.update_item(
            Key={
                "pk": f"PHOTO_RATE#{digest}",
                "sk": f"WINDOW#{window_start}",
            },
            UpdateExpression="SET expires_at = if_not_exists(expires_at, :expires) ADD request_count :one",
            ConditionExpression="attribute_not_exists(request_count) OR request_count < :limit",
            ExpressionAttributeValues={
                ":expires": window_end + 3600,
                ":one": 1,
                ":limit": PHOTO_UPLOAD_RATE_LIMIT_MAX,
            },
        )
        return True
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code == "ConditionalCheckFailedException":
            return False
        raise


def create_photo_upload(event):
    headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
    if not headers.get("content-type", "").lower().startswith("application/json"):
        return response(415, {"error": "Content-Type must be application/json."})
    if not PHOTO_BUCKET:
        print("Photo uploads are not configured: PHOTO_BUCKET is missing.")
        return response(503, {"error": "Photo uploads are temporarily unavailable."})

    body = event.get("body") or ""
    try:
        raw = base64.b64decode(body, validate=True) if event.get("isBase64Encoded") else body.encode("utf-8")
        if len(raw) > 1024:
            return response(413, {"error": "The request is too large."})
        payload = json.loads(raw.decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        return response(400, {"error": "Invalid upload request."})

    if not isinstance(payload, dict) or set(payload) - {"contentType", "website"}:
        return response(400, {"error": "Invalid upload request."})

    # A hidden form field catches unsophisticated automated submissions.
    if clean_text(payload.get("website", "")):
        return response(202, {"message": "Upload request accepted."})

    content_type = payload.get("contentType")
    if content_type not in PHOTO_ALLOWED_TYPES:
        return response(400, {"error": "Only JPEG, PNG and WebP photos are supported."})

    # Upload availability is controlled manually through the Lambda environment.
    if os.environ.get("PHOTO_UPLOAD_ENABLED", "false").strip().lower() != "true":
        return response(403, {"error": "Photo uploads are currently closed."})

    client_ip = request_ip(event)
    if not client_ip:
        return response(400, {"error": "The request could not be verified."})

    try:
        if not apply_photo_upload_rate_limit(client_ip):
            return response(
                429,
                {"error": "You've requested too many photo uploads. Please wait a few minutes and try again."},
                {"retry-after": str(PHOTO_UPLOAD_RATE_LIMIT_WINDOW_SECONDS)},
            )

        extension = PHOTO_ALLOWED_TYPES[content_type]
        object_key = f"uploads/{uuid.uuid4().hex}.{extension}"
        s3 = boto3.client("s3")
        upload = s3.generate_presigned_post(
            Bucket=PHOTO_BUCKET,
            Key=object_key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"Content-Type": content_type},
                ["content-length-range", 1, PHOTO_MAX_BYTES],
            ],
            ExpiresIn=300,
        )
    except ClientError:
        print("Could not create a presigned photo upload.")
        return response(503, {"error": "We couldn't prepare this upload. Please try again."})

    return response(200, {
        "uploadUrl": upload["url"],
        "fields": upload["fields"],
        "expiresIn": 300,
        "maxBytes": PHOTO_MAX_BYTES,
    })


def lambda_handler(event, context):
    path = event.get("rawPath", "")
    method = (event.get("requestContext", {}).get("http", {}).get("method") or "").upper()
    print("Received request:", path, method)

    if path == "/api/photos/upload":
        if method == "POST":
            return create_photo_upload(event)
        return response(405, {"error": "Method not allowed."}, {"allow": "POST"})

    if path == "/api/wishes":
        if method == "GET":
            return list_wishes()
        if method == "POST":
            return submit_wish(event)
        return response(405, {"error": "Method not allowed."}, {"allow": "GET, POST"})

    if path == "/api/gifts":
        if method == "GET":
            return list_gifts()
        return response(405, {"error": "Method not allowed."}, {"allow": "GET"})

    if path == "/api/gifts/reserve" and method == "POST":
        return reserve_gift(event)
    if path == "/api/gifts/unreserve" and method == "POST":
        return unreserve_gift(event)
    if path in ("/api/gifts/reserve", "/api/gifts/unreserve"):
        return response(405, {"error": "Method not allowed."}, {"allow": "POST"})

    return response(404, {"error": "Unsupported API path."})
