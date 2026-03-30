require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('./db');
const bcrypt   = require('bcryptjs');

async function seed() {
  console.log('Seeding BAM database…');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* ── Users ── */
    const adminHash = await bcrypt.hash('Admin1234!', 12);
    const userHash  = await bcrypt.hash('User1234!', 12);
    await client.query(`
      INSERT INTO users (email, password_hash, full_name, role) VALUES
        ('admin@bam.local',    $1, 'System Admin',    'admin'),
        ('treasurer@bam.local',$2, 'Marie Treasurer', 'treasurer'),
        ('manager@bam.local',  $2, 'Sophie Laurent',  'document_manager'),
        ('signer@bam.local',   $2, 'Jean Dupont',     'individual')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash, userHash]);

    /* ── Request Types ── */
    await client.query(`
      INSERT INTO request_types (name, description, mapped_entity_type) VALUES
        ('Account Opening',         'Required documents for new bank account opening',     'Account'),
        ('Account Closing',         'Documentation for account closure procedures',        'Account'),
        ('Change in Signers',       'Update authorized signatories on an account',         'Signer'),
        ('KYC Renewal',             'Know Your Customer periodic review documents',         'Company'),
        ('Company Name Change',     'Corporate name change documentation bundle',          'Company'),
        ('Beneficial Owner Update', 'Update beneficial ownership structure docs',          'Authority'),
        ('Mandate Renewal',         'Bank mandate and authority renewal package',          'Account')
      ON CONFLICT (name) DO NOTHING
    `);

    /* ── Document Types ── */
    await client.query(`
      INSERT INTO document_types (name, description, category, entity_type, is_sensitive) VALUES
        ('Certificate of Incorporation', 'Official document confirming company formation',   'Certificate of Incorporation', 'Company',   FALSE),
        ('Passport Copy',                'Personal identification for signers and owners',   'Personal ID',                  'Signer',    TRUE),
        ('Annual Balance Sheet',         'Most recent audited financial statements',         'Balance Sheet',                'Company',   FALSE),
        ('Board Resolution',             'Board resolution authorizing the transaction',     'Board Resolution',             'Authority', FALSE),
        ('Bank Account Agreement',       'Signed bank account terms and conditions',         'Account Agreement',            'Account',   FALSE),
        ('Utility Bill (Address Proof)', 'Recent utility bill for address verification',     'Personal ID',                  'Signer',    TRUE),
        ('Memorandum of Association',    'Company constitutional document',                  'MoA / AoA',                    'Company',   FALSE),
        ('Power of Attorney',            'Notarized power of attorney document',             'PoA',                          'Authority', FALSE)
      ON CONFLICT (name) DO NOTHING
    `);

    /* ── Entities ── */
    await client.query(`
      INSERT INTO entities (code, name, entity_type, country, currency, source) VALUES
        ('ACC-001', 'Société Générale EUR',  'Account', 'France',         'EUR', 'Kyriba'),
        ('ACC-002', 'HSBC GBP Account',      'Account', 'United Kingdom', 'GBP', 'Kyriba'),
        ('CMP-012', 'Alpine Holding SA',     'Company', 'Switzerland',    'CHF', 'Manual'),
        ('CMP-007', 'Meridian Partners BV',  'Company', 'Netherlands',    'EUR', 'Kyriba'),
        ('SGN-045', 'Jean Dupont',           'Signer',  'France',          NULL,  'Kyriba')
      ON CONFLICT (code) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('✅  Seed complete');
    console.log('');
    console.log('Demo credentials:');
    console.log('  admin@bam.local       / Admin1234!  (admin)');
    console.log('  treasurer@bam.local   / User1234!   (treasurer)');
    console.log('  manager@bam.local     / User1234!   (document_manager)');
    console.log('  signer@bam.local      / User1234!   (individual)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
