import httpx

from .settings import Settings


def main() -> None:
    settings = Settings.from_env()
    with httpx.Client(base_url=settings.base_url, headers={"Origin": settings.base_url}) as client:
        response = client.post(
            "/api/auth/sign-in/email",
            json={
                "email": settings.email,
                "password": settings.password,
            },
        )
        if response.is_success:
            client.post("/api/auth/sign-out", json={}).raise_for_status()
            print("Eval account already exists and login works.")
            return
        if response.status_code not in (400, 401):
            response.raise_for_status()
        response = client.post(
            "/api/auth/sign-up/email",
            json={
                "name": "Groundwork Evals",
                "email": settings.email,
                "password": settings.password,
            },
        )
        response.raise_for_status()
        client.post("/api/auth/sign-out", json={}).raise_for_status()
        print("Created the eval account. Login will use the normal session-cookie flow.")


if __name__ == "__main__":
    main()
