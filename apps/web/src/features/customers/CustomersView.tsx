'use client';

// Manual customers and contacts (SupplyPro GM core). The tables existed but there was no
// way to create a customer by hand — one only appeared via invoice auto-creation. These
// are real company records, created here and only here: nothing is invented, and a
// customer only exists because someone in the company added it.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { contactDisplayLabel, customerDisplayLabel } from './customers';

const Customer = z.object({
  id: z.string(),
  kind: z.string(),
  displayName: z.string(),
  companyName: z.string().nullable(),
  status: z.string(),
  billingAddress: z.unknown().nullable(),
  tags: z.array(z.string()),
  externalRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const Contact = z.object({
  id: z.string(),
  customerId: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.string().nullable(),
  isPrimary: z.boolean(),
  preferredChannel: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const CustomerList = z.object({ items: z.array(Customer) });
const CustomerDetail = z.object({ customer: Customer, contacts: z.array(Contact) });
type CustomerT = z.infer<typeof Customer>;
type ContactT = z.infer<typeof Contact>;

export function CustomersView() {
  return (
    <RouteGate routeId="customers">
      <CustomersContent />
    </RouteGate>
  );
}

function CustomersContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const key = orgKey(session.orgId, 'customers', 'list');
  const list = useQuery({ queryKey: key, queryFn: () => api.get('/v1/customers', { schema: CustomerList }) });
  const [kind, setKind] = useState<'person' | 'business'>('person');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const canWrite = session.check('customer:write');

  const create = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/customers',
        {
          kind,
          displayName: displayName.trim(),
          companyName: companyName.trim() || null,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        },
        { schema: Customer },
      ),
    onSuccess: () => {
      setDisplayName('');
      setCompanyName('');
      setTags('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (displayName.trim().length < 1) {
      setError('Enter a name for the customer.');
      return;
    }
    setError('');
    create.mutate();
  };

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Customers"
        description="Customers you create by hand — homeowners, builders, and businesses you work for. Jobs attach to these customers, and supplier orders follow the job."
      />
      <section className="web-card" aria-labelledby="customer-create-title">
        <h2 id="customer-create-title">Create customer</h2>
        <form className="cc-work-board__form" onSubmit={submit}>
          <label>
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as 'person' | 'business')}>
              <option value="person">Person</option>
              <option value="business">Business</option>
            </select>
          </label>
          <label>
            Name
            <input
              required
              maxLength={200}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Homeowner"
            />
          </label>
          <label>
            Company (optional)
            <input
              maxLength={200}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Builders LLC"
            />
          </label>
          <label>
            Tags, comma separated (optional)
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="builder, repeat" />
          </label>
          <button className="cc-btn cc-btn--primary" type="submit" disabled={!canWrite.allowed || create.isPending}>
            {create.isPending ? 'Saving customer…' : 'Create customer'}
          </button>
        </form>
        {!canWrite.allowed && <p className="web-muted">{canWrite.reason}</p>}
      </section>
      <section className="web-section" aria-labelledby="customers-list-title">
        <h2 id="customers-list-title">Your customers</h2>
        {list.isPending && <p role="status">Loading your customers…</p>}
        {list.error && <ErrorNotice error={list.error} title="Could not load customers" onRetry={() => void list.refetch()} />}
        {list.data?.items.length === 0 && <p className="web-card">No customers yet. Create your first customer above.</p>}
        <div className="cc-work-board__cards">
          {(list.data?.items ?? []).map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              open={openId === customer.id}
              onToggle={() => setOpenId(openId === customer.id ? null : customer.id)}
            />
          ))}
        </div>
      </section>
      {error && <p className="web-error" role="alert">{error}</p>}
    </main>
  );
}

function CustomerCard({
  customer,
  open,
  onToggle,
}: {
  customer: CustomerT;
  open: boolean;
  onToggle: () => void;
}) {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const detailKey = orgKey(session.orgId, 'customers', 'detail', customer.id);
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => api.get('/v1/customers/' + encodeURIComponent(customer.id), { schema: CustomerDetail }),
    enabled: open,
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [primary, setPrimary] = useState(false);
  const [error, setError] = useState('');
  const canWrite = session.check('customer:write');

  const addContact = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/customers/' + encodeURIComponent(customer.id) + '/contacts',
        {
          displayName: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          role: role.trim() || null,
          isPrimary: primary,
        },
        { schema: Contact },
      ),
    onSuccess: () => {
      setName('');
      setEmail('');
      setPhone('');
      setRole('');
      setPrimary(false);
      setError('');
      void queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const submitContact = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 1) {
      setError('Enter a name for the contact.');
      return;
    }
    setError('');
    addContact.mutate();
  };

  return (
    <article className="web-card">
      <div className="cc-work-board__cardhead">
        <strong>{customerDisplayLabel(customer)}</strong>
        <span>{customer.kind === 'business' ? 'Business' : 'Person'}</span>
      </div>
      <p className="web-muted web-small">
        {customer.tags.length > 0 ? customer.tags.join(', ') : 'No tags'} · {customer.status}
      </p>
      <button type="button" className="cc-btn" aria-expanded={open} onClick={onToggle}>
        {open ? 'Hide contacts' : 'Contacts'}
      </button>
      {open && (
        <div>
          {detail.isPending && <p role="status">Loading contacts…</p>}
          {detail.error && <ErrorNotice error={detail.error} title="Could not load contacts" onRetry={() => void detail.refetch()} />}
          {(detail.data?.contacts ?? []).map((contact: ContactT) => (
            <p key={contact.id} className="web-small">
              {contactDisplayLabel(contact)}
              {contact.isPrimary ? ' · Primary' : ''}
            </p>
          ))}
          {detail.data && detail.data.contacts.length === 0 && (
            <p className="web-muted web-small">No contacts yet.</p>
          )}
          {canWrite.allowed && (
            <form className="cc-work-board__form" onSubmit={submitContact}>
              <label>
                Contact name
                <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Homeowner" />
              </label>
              <label>
                Email (optional)
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
              </label>
              <label>
                Phone (optional)
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="469-555-0100" />
              </label>
              <label>
                Role (optional)
                <input value={role} maxLength={100} onChange={(e) => setRole(e.target.value)} placeholder="Owner" />
              </label>
              <label>
                <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} /> Primary contact
              </label>
              <button className="cc-btn cc-btn--primary" type="submit" disabled={addContact.isPending}>
                {addContact.isPending ? 'Adding…' : 'Add contact'}
              </button>
            </form>
          )}
          {error && <p className="web-error" role="alert">{error}</p>}
        </div>
      )}
    </article>
  );
}
