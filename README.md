

## Setup steps

### 1. Clone the project into `xampp/htdocs`

Open a terminal (Command Prompt, PowerShell or Git Bash) and run:

```bash
cd C:\xampp\htdocs
git clone https://github.com/kylealino/larga-fmsv2.git
```

This creates the folder `C:\xampp\htdocs\larga-fmsv2`.

> **Keep the folder name `larga-fmsv2`.** The app's address is set to
> `http://localhost/larga-fmsv2/public/` in `app/Config/App.php`. If you rename the
> folder, update `$baseURL` in that file to match.

### 2. Open the project in VS Code

```bash
cd larga-fmsv2
code .
```

(Or in VS Code: **File → Open Folder…** → choose `C:\xampp\htdocs\larga-fmsv2`.)

### 3. Start XAMPP

Open the **XAMPP Control Panel** and click **Start** for:

- **Apache**
- **MySQL**

Both should turn green.

### 4. Create the database and import the SQL file

1. Open <http://localhost/phpmyadmin> in your browser.
2. Click **New** in the left panel.
3. Enter the database name **`largafmsv2`** and click **Create**.
   (Leave the collation as the default, or choose `utf8mb4_general_ci`.)
4. With `largafmsv2` selected, open the **Import** tab.
5. Click **Choose File** and select the SQL file from the project:
   `C:\xampp\htdocs\larga-fmsv2\db\largafmsv2.sql`
6. Click **Import** (at the bottom of the page) and wait for the success message.

> The database name must be exactly **`largafmsv2`** — that is the name the app
> connects to (see `app/Config/Database.php`: user `root`, no password).

### 5. Open the app

Go to:

**<http://localhost/larga-fmsv2/public>**

Log in with one of these accounts:

| Username     | Password |
|--------------|----------|
| `ADMIN`      | `123456` |
