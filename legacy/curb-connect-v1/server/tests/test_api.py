from conftest import create_project, register


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_register_login_and_me(client):
    headers = register(client, "Owner@Example.com", "Curb Co")
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["email"] == "owner@example.com"
    assert me["company"]["name"] == "Curb Co"

    ok = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-battery"})
    assert ok.status_code == 200
    bad = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "wrong-password"})
    assert bad.status_code == 401
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever-123"})
    assert unknown.status_code == 401
    assert bad.json()["detail"] == unknown.json()["detail"]


def test_duplicate_email_and_weak_password_rejected(client):
    register(client, "a@example.com")
    dup = client.post(
        "/api/auth/register",
        json={"companyName": "X", "name": "Y", "email": "A@example.com", "password": "correct-horse-battery"},
    )
    assert dup.status_code == 409
    weak = client.post("/api/auth/register", json={"companyName": "X", "name": "Y", "email": "b@example.com", "password": "short"})
    assert weak.status_code == 422


def test_requires_auth(client):
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_companies_cannot_see_each_others_jobs(client, contractor, sub):
    project = create_project(client, contractor)
    assert client.get("/api/projects", headers=sub).json() == []
    assert client.get(f"/api/projects/{project['id']}", headers=sub).status_code == 404
    assert client.post(f"/api/projects/{project['id']}/messages", json={"body": "hi"}, headers=sub).status_code == 404


def test_invite_links_subcontractor_and_roles_apply(client, contractor, sub):
    project = create_project(client, contractor)
    invite = client.post(f"/api/projects/{project['id']}/invites", json={}, headers=contractor).json()
    assert client.post(f"/api/projects/{project['id']}/invites", json={}, headers=sub).status_code == 404

    joined = client.post(f"/api/invites/{invite['token']}/accept", headers=sub)
    assert joined.status_code == 200
    assert joined.json()["viewerRole"] == "Subcontractor"
    # Invites work once.
    assert client.post(f"/api/invites/{invite['token']}/accept", headers=sub).status_code == 404

    message = client.post(f"/api/projects/{project['id']}/messages", json={"body": "Crew on site"}, headers=sub).json()
    assert message["messages"][0]["sender"] == "Subcontractor"
    task = client.post(f"/api/projects/{project['id']}/tasks", json={"title": "Set forms"}, headers=sub).json()
    assert any(t["title"] == "Set forms" and t["owner"] == "Subcontractor" for t in task["tasks"])

    # Subs can move work along but not change the contract or close the job.
    assert client.patch(f"/api/projects/{project['id']}", json={"status": "finished"}, headers=sub).status_code == 200
    assert client.patch(f"/api/projects/{project['id']}", json={"contractCents": 1}, headers=sub).status_code == 403
    assert client.patch(f"/api/projects/{project['id']}", json={"status": "complete"}, headers=sub).status_code == 403


def test_payments_validate_balance_and_close_out(client, contractor):
    project = create_project(client, contractor, contractCents=100_000)
    pid = project["id"]
    assert client.post(f"/api/projects/{pid}/payments", json={"amountCents": 100_001}, headers=contractor).status_code == 400
    assert client.post(f"/api/projects/{pid}/payments", json={"amountCents": 0}, headers=contractor).status_code == 422

    client.patch(f"/api/projects/{pid}", json={"status": "finished"}, headers=contractor)
    partial = client.post(f"/api/projects/{pid}/payments", json={"amountCents": 40_000}, headers=contractor).json()
    assert partial["paidCents"] == 40_000
    assert partial["paymentStatus"] == "partial"
    assert partial["status"] == "finished"

    paid = client.post(f"/api/projects/{pid}/payments", json={"amountCents": 60_000}, headers=contractor).json()
    assert paid["paidCents"] == 100_000
    assert paid["status"] == "complete"
    assert paid["completedDate"]


def test_document_upload_download_and_limits(client, contractor):
    pid = create_project(client, contractor)["id"]
    uploaded = client.post(
        f"/api/projects/{pid}/documents",
        files=[("files", ("plan.pdf", b"%PDF-1.4 demo", "application/pdf"))],
        headers=contractor,
    ).json()
    document = uploaded["documents"][0]
    assert document["name"] == "plan.pdf"
    assert document["size"] == len(b"%PDF-1.4 demo")

    fetched = client.get(f"/api/projects/{pid}/documents/{document['id']}", headers=contractor)
    assert fetched.content == b"%PDF-1.4 demo"
    assert fetched.headers["content-disposition"].startswith("inline")

    # HTML is always downloaded, never rendered in the app's origin.
    html = client.post(
        f"/api/projects/{pid}/documents",
        files=[("files", ("x.html", b"<script>alert(1)</script>", "text/html"))],
        headers=contractor,
    ).json()["documents"][0]
    served = client.get(f"/api/projects/{pid}/documents/{html['id']}", headers=contractor)
    assert served.headers["content-disposition"].startswith("attachment")
    assert served.headers["content-type"] == "application/octet-stream"

    too_big = client.post(
        f"/api/projects/{pid}/documents",
        files=[("files", ("huge.bin", b"0" * (1024 * 1024 + 1), "application/octet-stream"))],
        headers=contractor,
    )
    assert too_big.status_code == 413

    removed = client.delete(f"/api/projects/{pid}/documents/{document['id']}", headers=contractor).json()
    assert all(d["id"] != document["id"] for d in removed["documents"])


def test_invoice_lifecycle_applies_pre_tax_payment(client, contractor):
    project = create_project(client, contractor, contractCents=1_850_000)
    client.post(f"/api/projects/{project['id']}/payments", json={"amountCents": 650_000}, headers=contractor)

    invoice = client.post("/api/invoices", json={"projectId": project["id"]}, headers=contractor).json()
    assert invoice["number"] == "INV-1001"
    assert invoice["lineItems"][0]["unitPriceCents"] == 1_200_000

    updated = client.patch(
        f"/api/invoices/{invoice['id']}", json={"taxRatePercent": 8.25, "retainagePercent": 10}, headers=contractor
    ).json()
    assert updated["taxRatePercent"] == 8.25

    assert client.post(f"/api/invoices/{invoice['id']}/pay", headers=contractor).status_code == 409
    sent = client.post(f"/api/invoices/{invoice['id']}/send", headers=contractor).json()
    assert sent["status"] == "sent"
    assert client.patch(f"/api/invoices/{invoice['id']}", json={"notes": "x"}, headers=contractor).status_code == 409

    paid = client.post(f"/api/invoices/{invoice['id']}/pay", headers=contractor).json()
    # 12,000 + 8.25% tax = 12,990; 10% retainage leaves 11,691 due; the pre-tax share is 10,800.
    assert paid["appliedCents"] == 1_080_000
    job = client.get(f"/api/projects/{project['id']}", headers=contractor).json()
    assert job["paidCents"] == 650_000 + 1_080_000
    assert job["invoiceNumber"] == "INV-1001"

    second = client.post("/api/invoices", json={"projectId": project["id"]}, headers=contractor).json()
    assert second["number"] == "INV-1002"
    clash = client.patch(f"/api/invoices/{second['id']}", json={"number": "INV-1001"}, headers=contractor)
    assert clash.status_code == 409


def test_sent_invoices_are_visible_to_the_other_party_but_drafts_are_not(client, contractor, sub):
    project = create_project(client, contractor)
    invite = client.post(f"/api/projects/{project['id']}/invites", json={}, headers=contractor).json()
    client.post(f"/api/invites/{invite['token']}/accept", headers=sub)

    draft = client.post("/api/invoices", json={"projectId": project["id"]}, headers=sub).json()
    assert draft["id"] not in client.get("/api/sync", headers=contractor).json()["invoiceIds"]
    client.post(f"/api/invoices/{draft['id']}/send", headers=sub)
    assert draft["id"] in client.get("/api/sync", headers=contractor).json()["invoiceIds"]
    # The contractor can read it but only the issuer can act on it.
    assert client.post(f"/api/invoices/{draft['id']}/void", headers=contractor).status_code == 404


def test_sync_returns_only_changes_since_last_call(client, contractor):
    first = create_project(client, contractor, name="First")
    initial = client.get("/api/sync", headers=contractor).json()
    assert [p["id"] for p in initial["projects"]] == [first["id"]]

    quiet = client.get("/api/sync", params={"since": initial["serverTime"]}, headers=contractor).json()
    assert quiet["projects"] == []
    assert quiet["projectIds"] == [first["id"]]

    client.post(f"/api/projects/{first['id']}/messages", json={"body": "Pour moved to Friday"}, headers=contractor)
    changed = client.get("/api/sync", params={"since": initial["serverTime"]}, headers=contractor).json()
    assert [p["id"] for p in changed["projects"]] == [first["id"]]
    assert changed["projects"][0]["messages"][0]["body"] == "Pour moved to Friday"
