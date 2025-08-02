const express = require("express");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PORT = process.env.PORT || 5000;

require("dotenv").config();

const { Pool } = require("pg");
const DATABASE_URL = process.env.DATABASE_URL;

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        require: true,
    },
});

async function getPostgresVersion() {
    const client = await pool.connect();
    try {
        const response = await client.query("SELECT version()");
        console.log(response.rows[0]);
    } finally {
        client.release();
    }
}

app.post("/cart", async (req, res) => {
    const { user_email, product_id, product_name, price, quantity, image_url } = req.body;

    try {
        const client = await pool.connect();

        const existing = await client.query(
            "SELECT * FROM cart WHERE user_email = $1 AND product_id = $2",
            [user_email, product_id]
        );

        let result;

        if (existing.rows.length > 0) {

            result = await client.query(
                `UPDATE cart 
         SET quantity = quantity + $1 
         WHERE user_email = $2 AND product_id = $3 
         RETURNING *`,
                [quantity, user_email, product_id]
            );
        } else {

            result = await client.query(
                `INSERT INTO cart 
         (user_email, product_id, product_name, price, quantity, image_url, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) 
         RETURNING *`,
                [user_email, product_id, product_name, price, quantity, image_url]
            );
        }

        client.release();
        res.status(200).json(result.rows[0]);

    } catch (err) {
        console.error("INSERT CART ERROR:", err);
        res.status(500).json({ error: "Failed to add item to cart" });
    }
});

app.get("/cart/:user_email", async (req, res) => {
    const { user_email } = req.params;
    try {
        const client = await pool.connect();
        const result = await client.query(
            "SELECT * FROM cart WHERE user_email = $1 ORDER BY created_at DESC",
            [user_email]
        );
        client.release();
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("GET CART ERROR:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.put("/cart/:id", async (req, res) => {
    const { id } = req.params;
    const { quantity } = req.body;

    try {
        const client = await pool.connect();
        const result = await client.query(
            "UPDATE cart SET quantity = $1 WHERE id = $2 RETURNING *",
            [quantity, id]
        );
        client.release();

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Cart item not found" });
        }

        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error("UPDATE CART ERROR:", err);
        res.status(500).json({ error: "Failed to update item quantity" });
    }
});

app.delete("/cart/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const client = await pool.connect();
        const result = await client.query("DELETE FROM cart WHERE id = $1 RETURNING *", [id]);
        client.release();
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Cart item not found" });
        }
        res.status(200).json({ message: "Item deleted", item: result.rows[0] });
    } catch (err) {
        console.error("DELETE CART ERROR:", err);
        res.status(500).json({ error: "Failed to delete item" });
    }
});

app.post("/create-checkout-session", async (req, res) => {
    const { cartItems } = req.body;

    try {
        const lineItems = cartItems.map((item) => ({
            price_data: {
                currency: "myr",
                product_data: {
                    name: item.product_name,
                },
                unit_amount: Math.round(item.price * 100),
            },
            quantity: item.quantity,
        }));

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: lineItems,
            mode: "payment",
            success_url: "https://iron-fuel-frontend-e7xl.vercel.app/success",
            cancel_url: "https://iron-fuel-frontend-e7xl.vercel.app/cart",
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).json({ error: "Failed to create checkout session" });
    }
});

app.delete("/cart/clear/:user_email", async (req, res) => {
    const { user_email } = req.params;
    try {
        const client = await pool.connect();
        await client.query("DELETE FROM cart WHERE user_email = $1", [user_email]);
        client.release();
        res.status(200).json({ message: "Cart cleared successfully" });
    } catch (err) {
        console.error("CLEAR CART ERROR:", err);
        res.status(500).json({ error: "Failed to clear cart" });
    }
});


app.get("/", (req, res) => {
    res.send("Welcome to the IronFuel API!");
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    getPostgresVersion().catch((err) => console.error("Failed to get Postgres version:", err));
});